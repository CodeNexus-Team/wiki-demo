# add_index.py
from __future__ import annotations
from typing import List, Dict, Tuple, Optional

import time
from neo4j import GraphDatabase
from openai import OpenAI
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type

from utils import NEO4J_URI, NEO4J_USER, NEO4J_PASSWORD, OPENAI_BASE_URL

OPENAI_MODEL = "text-embedding-3-small"
VECTOR_DIMENSION = 1536
# 注意：这里没有 Block
NODE_LABELS = ["File", "Class", "Annotation", "Enum", "Field",
               "Interface", "Method", "Package", "Record"]

READ_BATCH_SIZE = 2000
EMBED_BATCH_SIZE = 128
WRITE_BATCH_SIZE = 1000
CREATE_INDEX_AFTER_WRITES = True


# ===== 工具函数 =====
def _clean_text(s: Optional[str]) -> Optional[str]:
    if s is None:
        return None
    s = s.replace("\n", " ").strip()
    return s if s else None


class OpenAIIndexer:
    def __init__(self, uri: str, user: str, password: str, database: str = "neo4j"):
        self.driver = GraphDatabase.driver(uri, auth=(user, password))
        self.database = database
        self.openai = OpenAI(base_url=OPENAI_BASE_URL)
        print("OpenAI 客户端初始化成功。")

    def close(self):
        self.driver.close()

    # 对 OpenAI embeddings 调用做指数退避重试（429/5xx 网络抖动时很有用）
    @retry(
        stop=stop_after_attempt(6),
        wait=wait_exponential(multiplier=1, min=1, max=20),
        retry=retry_if_exception_type(Exception),
        reraise=True
    )
    def _embed_batch(self, texts: List[str]) -> List[List[float]]:
        resp = self.openai.embeddings.create(model=OPENAI_MODEL, input=texts)
        # 顺序与输入一致
        return [d.embedding for d in resp.data]

    def process_and_index_nodes(self):
        """
        为所有标签生成以下文本字段的向量，并创建对应索引：
          - name_search          -> name_embedding
          - module_explaination  -> explaination_embedding
          - SE_Why               -> why_embedding
          - SE_When              -> when_embedding
          - SE_How               -> how_embedding
        """
        for label in NODE_LABELS:
            print(f"\n===== 处理标签: {label} =====")
            # 1) name
            self._generate_vectors_for_property(label, "name_search", "name_embedding")
            # 2) What
            self._generate_vectors_for_property(label, "module_explaination", "explaination_embedding")
            # 3) Why / When / How
            self._generate_vectors_for_property(label, "SE_Why", "why_embedding")
            self._generate_vectors_for_property(label, "SE_When", "when_embedding")
            self._generate_vectors_for_property(label, "SE_How", "how_embedding")

            if CREATE_INDEX_AFTER_WRITES:
                self._create_indexes_for_label(label)

        print("\n所有标签处理完成！")

    def _generate_vectors_for_property(self, label: str, text_property: str, vector_property: str):
        print(f"--- 生成 '{label}.{text_property}' -> '{vector_property}' ---")
        total_written = 0
        with self.driver.session(database=self.database) as session:
            # 用分页的方式拉取“尚未嵌入”的节点（避免一次性拉太多占内存）
            skip = 0
            while True:
                records = session.run(
                    f"""
                    MATCH (n:{label})
                    WHERE n.{text_property} IS NOT NULL AND n.{vector_property} IS NULL
                    RETURN elementId(n) AS id, n.{text_property} AS text
                    SKIP $skip LIMIT $limit
                    """,
                    skip=skip,
                    limit=READ_BATCH_SIZE
                ).data()

                if not records:
                    break

                # 组装清洗后的批
                pairs: List[Tuple[str, str]] = []
                for r in records:
                    t = _clean_text(r["text"])
                    if t:
                        pairs.append((r["id"], t))
                if not pairs:
                    skip += READ_BATCH_SIZE
                    continue

                # 将这批再切成若干 micro-batches 调用 embeddings
                cur = 0
                buffer_for_write: List[Dict] = []
                while cur < len(pairs):
                    sub = pairs[cur:cur + EMBED_BATCH_SIZE]
                    cur += EMBED_BATCH_SIZE

                    ids = [p[0] for p in sub]
                    texts = [p[1] for p in sub]

                    # 批量 embedding
                    try:
                        embeddings = self._embed_batch(texts)
                    except Exception as e:
                        # 若某次调用失败，打印并继续（已自动重试过）
                        print(f"[WARN] embeddings 调用失败，跳过该子批: {e}")
                        continue

                    # 聚合到写缓存
                    for nid, emb in zip(ids, embeddings):
                        buffer_for_write.append({"id": nid, "embedding": emb})

                    # 达到写入阈值就落库
                    if len(buffer_for_write) >= WRITE_BATCH_SIZE:
                        written = self._write_embeddings(session, vector_property, buffer_for_write)
                        total_written += written
                        buffer_for_write.clear()
                        print(f"已写入 {total_written} 条（{label}.{text_property}）")

                # flush 剩余
                if buffer_for_write:
                    written = self._write_embeddings(session, vector_property, buffer_for_write)
                    total_written += written
                    buffer_for_write.clear()
                    print(f"已写入 {total_written} 条（{label}.{text_property}）")

                skip += READ_BATCH_SIZE

        print(f"✅ 完成：为 {label} 的 '{text_property}' 写入向量 {total_written} 条 -> '{vector_property}'。")

    @staticmethod
    def _write_embeddings(session, vector_property: str, rows: List[Dict]) -> int:
        """
        用 UNWIND 批量写回，提高吞吐。
        rows: [{'id': elementId(n), 'embedding': [...]}]
        """
        if not rows:
            return 0
        session.execute_write(
            lambda tx: tx.run(
                f"""
                UNWIND $rows AS row
                MATCH (n)
                WHERE elementId(n) = row.id
                SET n.{vector_property} = row.embedding
                """,
                rows=rows
            ).consume()
        )
        return len(rows)

    def _create_indexes_for_label(self, label: str):
        print(f"--- 创建 '{label}' 向量索引 ---")
        with self.driver.session(database=self.database) as session:
            # name_embedding
            session.run(
                f"""
                CREATE VECTOR INDEX `name_embedding_{label.lower()}` IF NOT EXISTS
                FOR (n:{label}) ON (n.name_embedding)
                OPTIONS {{
                  indexConfig: {{
                    `vector.dimensions`: $dim,
                    `vector.similarity_function`: 'cosine'
                  }}
                }}
                """,
                dim=VECTOR_DIMENSION
            )
            # explaination_embedding (What)
            session.run(
                f"""
                CREATE VECTOR INDEX `explaination_embedding_{label.lower()}` IF NOT EXISTS
                FOR (n:{label}) ON (n.explaination_embedding)
                OPTIONS {{
                  indexConfig: {{
                    `vector.dimensions`: $dim,
                    `vector.similarity_function`: 'cosine'
                  }}
                }}
                """,
                dim=VECTOR_DIMENSION
            )
            # Why
            session.run(
                f"""
                CREATE VECTOR INDEX `why_embedding_{label.lower()}` IF NOT EXISTS
                FOR (n:{label}) ON (n.why_embedding)
                OPTIONS {{
                  indexConfig: {{
                    `vector.dimensions`: $dim,
                    `vector.similarity_function`: 'cosine'
                  }}
                }}
                """,
                dim=VECTOR_DIMENSION
            )
            # When
            session.run(
                f"""
                CREATE VECTOR INDEX `when_embedding_{label.lower()}` IF NOT EXISTS
                FOR (n:{label}) ON (n.when_embedding)
                OPTIONS {{
                  indexConfig: {{
                    `vector.dimensions`: $dim,
                    `vector.similarity_function`: 'cosine'
                  }}
                }}
                """,
                dim=VECTOR_DIMENSION
            )
            # How
            session.run(
                f"""
                CREATE VECTOR INDEX `how_embedding_{label.lower()}` IF NOT EXISTS
                FOR (n:{label}) ON (n.how_embedding)
                OPTIONS {{
                  indexConfig: {{
                    `vector.dimensions`: $dim,
                    `vector.similarity_function`: 'cosine'
                  }}
                }}
                """,
                dim=VECTOR_DIMENSION
            )

        print(
            "索引已创建或已存在："
            f"name_embedding_{label.lower()}, "
            f"explaination_embedding_{label.lower()}, "
            f"why_embedding_{label.lower()}, "
            f"when_embedding_{label.lower()}, "
            f"how_embedding_{label.lower()}"
        )


def main():
    indexer = OpenAIIndexer(NEO4J_URI, NEO4J_USER, NEO4J_PASSWORD)
    try:
        indexer.process_and_index_nodes()
    finally:
        indexer.close()


if __name__ == "__main__":
    main()

# ====== fulltext 索引的 Cypher 放成多行注释 ======
"""
-- 在 Neo4j Browser 中手动执行的 fulltext 索引 --

CREATE FULLTEXT INDEX explanation_index_cjk
FOR (n:Block|File|Class|Annotation|Enum|Field|Interface|Method|Package|Record)
ON EACH [n.module_explaination]
OPTIONS {
  indexConfig: {
    `fulltext.analyzer`: 'cjk'
  }
};

CREATE FULLTEXT INDEX name_search_index_english
FOR (n:Block|File|Class|Annotation|Enum|Field|Interface|Method|Package|Record)
ON EACH [n.name_search]
OPTIONS { indexConfig: { `fulltext.analyzer`: 'english' } };
"""
