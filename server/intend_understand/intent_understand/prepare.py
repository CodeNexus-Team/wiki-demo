# prepare.py
from __future__ import annotations
from typing import Any, Dict, List, Optional
import json
import time

from neo4j import Driver
from utils import get_neo4j_driver, _name_to_search_text  # _name_to_search_text 从 utils 导入

# ===== 1. populate_member_fqn =====

def populate_member_fqn(driver: Driver, overwrite: bool = False) -> int:
    """
    为 (Method|Field) 节点 A 补齐 fully_qualified_name：
    选择其上级 B（通过 B-[:DECLARES]->A），并且 B 已有 fully_qualified_name，
    将 A.fully_qualified_name 设为 B.fully_qualified_name + ":" + A.name。

    参数：
      - overwrite: 是否覆盖已有的 A.fully_qualified_name（默认 False：仅填空）
    返回：
      - 实际写入的节点数量
    """
    where_not_set = "" if overwrite else "AND a.fully_qualified_name IS NULL"

    cypher = f"""
    // 选择 Method/Field 节点，且具备 name；上级 B 通过 DECLARES 指向 A，且 B 已有 FQN
    MATCH (b)-[:DECLARES]->(a)
    WHERE (a:Method OR a:Field)
      AND a.name IS NOT NULL
      AND b.fully_qualified_name IS NOT NULL
      {where_not_set}
    // 若存在多个上级 B，选择 FQN 字符串最长的一个（通常最具体的命名空间/类/包）
    WITH a, b
    ORDER BY size(b.fully_qualified_name) DESC
    WITH a, collect(b.fully_qualified_name)[0] AS parent_fqn
    // 仅当 parent_fqn 与 a.name 均可用时写入
    SET a.fully_qualified_name = parent_fqn + ":" + a.name
    RETURN count(a) AS updatedCount
    """

    with driver.session() as session:
        res = session.run(cypher).single()
        return int(res["updatedCount"]) if res else 0


# ===== 2. populate_module_explaination_for_labels =====
def populate_module_explaination_for_labels(
    driver,
    labels: Optional[List[str]] = None,
    batch_size: int = 1000,
    verbose: bool = True,
    progress_every: int = 1,  # 每处理多少个 batch 打印一次
) -> None:
    """
    读取指定标签集合的所有节点，
    从 semantic_explanation 中解析 JSON，提取 What/Why/When/How：
      - What  -> 写入 module_explaination
      - Why   -> 写入 SE_Why
      - When  -> 写入 SE_When
      - How   -> 写入 SE_How

    对于 Block 节点的处理保持不变：
      - 在函数结尾对所有 Block 节点执行一次复制：
        SET b.module_explaination = b.semantic_explanation

    说明：
    - 若 semantic_explanation 为空、非字符串、或 JSON 解析失败，则 4 个字段都写入空字符串 ""。
    - 通过 toString(nodeId) 宽松匹配，避免 nodeId 类型不一致问题（字符串/整数）。
    - 分批更新，减少单次事务体积。
    """
    if labels is None:
        labels = ["File", "Class", "Annotation", "Enum", "Field",
                  "Interface", "Method", "Package", "Record"]

    def _fetch_all(tx):
        return list(tx.run("""
            MATCH (n)
            WHERE ANY(l IN labels(n) WHERE l IN $labels)
            RETURN n.nodeId AS nodeId, n.semantic_explanation AS se
        """, {"labels": labels}))

    def _update_batch(tx, rows: List[Dict[str, Any]], labels_local: List[str]) -> int:
        # 返回本批次设置的属性数量（便于打印）
        summary = tx.run("""
            UNWIND $rows AS row
            MATCH (n)
            WHERE toString(n.nodeId) = toString(row.nodeId)
              AND ANY(l IN labels(n) WHERE l IN $labels)
            SET n.module_explaination = row.module_explaination,
                n.SE_Why             = row.SE_Why,
                n.SE_When            = row.SE_When,
                n.SE_How             = row.SE_How
        """, {"rows": rows, "labels": labels_local}).consume()
        return getattr(summary.counters, "properties_set", 0)

    def _extract_se_fields(se_val: Any) -> Dict[str, str]:
        """
        从 semantic_explanation 中解析出:
          - module_explaination: What / what
          - SE_Why:              Why  / why
          - SE_When:             When / when
          - SE_How:              How  / how
        若解析失败或缺失，则对应字段为 ""。
        """
        def _from_dict(obj: Dict[str, Any]) -> Dict[str, str]:
            def _get(obj, *keys) -> str:
                for k in keys:
                    v = obj.get(k)
                    if v:
                        return str(v)
                return ""
            return {
                "module_explaination": _get(obj, "What", "what"),
                "SE_Why":              _get(obj, "Why", "why"),
                "SE_When":             _get(obj, "When", "when"),
                "SE_How":              _get(obj, "How", "how"),
            }

        # dict 直接取
        if isinstance(se_val, dict):
            return _from_dict(se_val)

        # str 尝试 JSON 解析
        if isinstance(se_val, str) and se_val.strip():
            try:
                obj = json.loads(se_val)
                if isinstance(obj, dict):
                    return _from_dict(obj)
            except Exception:
                pass

        # 其它情况：全部置空
        return {
            "module_explaination": "",
            "SE_Why": "",
            "SE_When": "",
            "SE_How": "",
        }

    def _copy_block_module_explaination(tx) -> int:
        summary = tx.run("""
            MATCH (b:Block)
            SET b.module_explaination = b.semantic_explanation
        """).consume()
        return getattr(summary.counters, "properties_set", 0)

    t0 = time.perf_counter()
    with driver.session() as session:
        # 读取全部候选
        records = session.execute_read(_fetch_all)
        total = len(records)
        if verbose:
            print(f"[populate] labels={labels}, batch_size={batch_size}, total_records={total}")

        batch: List[Dict[str, Any]] = []
        processed = 0
        batch_idx = 0
        props_set_total = 0

        for rec in records:
            node_id = rec["nodeId"]
            se = rec["se"]
            fields = _extract_se_fields(se)
            # row: nodeId + 4 个字段
            row = {"nodeId": node_id}
            row.update(fields)
            batch.append(row)

            if len(batch) >= batch_size:
                batch_idx += 1
                t_batch0 = time.perf_counter()
                props_set = session.execute_write(_update_batch, batch, labels)
                props_set_total += props_set
                processed += len(batch)
                batch_elapsed = time.perf_counter() - t_batch0
                if verbose and (batch_idx % progress_every == 0):
                    print(
                        f"[populate] batch #{batch_idx} "
                        f"size={len(batch)} processed={processed}/{total} "
                        f"props_set={props_set} elapsed={batch_elapsed:.2f}s"
                    )
                batch.clear()

        # 尾批
        if batch:
            batch_idx += 1
            t_batch0 = time.perf_counter()
            props_set = session.execute_write(_update_batch, batch, labels)
            props_set_total += props_set
            processed += len(batch)
            batch_elapsed = time.perf_counter() - t_batch0
            if verbose:
                print(
                    f"[populate] batch #{batch_idx} (final) "
                    f"size={len(batch)} processed={processed}/{total} "
                    f"props_set={props_set} elapsed={batch_elapsed:.2f}s"
                )
            batch.clear()

        # Block 复制（逻辑不变）
        t_block0 = time.perf_counter()
        block_props_set = session.execute_write(_copy_block_module_explaination)
        t_block_elapsed = time.perf_counter() - t_block0
        t_all = time.perf_counter() - t0

        if verbose:
            print(
                f"[populate] Block copy done: properties_set={block_props_set} "
                f"(elapsed={t_block_elapsed:.2f}s)"
            )
            print(
                f"[populate] DONE. processed={processed}, total={total}, "
                f"props_set_total(non-Block)={props_set_total}, total_elapsed={t_all:.2f}s"
            )


# ===== 3. populate_name_search_for_all_nodes =====

def populate_name_search_for_all_nodes(
    driver,
    batch_size: int = 1000,
    verbose: bool = True,
    progress_every: int = 1,   # 每处理多少个 batch 打印一次
) -> None:
    """
    遍历全库节点，读取 n.name，规范化为可全文检索的空格分词串，写入 n.name_search。
    - 使用内部 id(n) 进行批量更新，避免 name 非唯一的问题。
    """

    def _fetch_all(tx):
        # 仅拉取存在 name 属性的节点
        return list(tx.run("""
            MATCH (n:Block)
            WHERE n.name IS NOT NULL
            RETURN id(n) AS nid, n.name AS name
        """))

    def _update_batch(tx, rows: List[Dict[str, Any]]) -> int:
        # 返回本批次设置的属性数量，便于统计
        summary = tx.run("""
            UNWIND $rows AS row
            MATCH (n) WHERE id(n) = row.nid
            SET n.name_search = row.name_search
        """, {"rows": rows}).consume()
        return getattr(summary.counters, "properties_set", 0)

    t0 = time.perf_counter()
    with driver.session() as session:
        recs = session.execute_read(_fetch_all)
        total = len(recs)
        if verbose:
            print(f"[name_search] total nodes with name: {total}, batch_size={batch_size}")

        batch: List[Dict[str, Any]] = []
        processed = 0
        batch_idx = 0
        props_set_total = 0

        for r in recs:
            nid = r["nid"]
            name = r["name"]
            name_search = _name_to_search_text(name)
            batch.append({"nid": nid, "name_search": name_search})

            if len(batch) >= batch_size:
                batch_idx += 1
                t_b0 = time.perf_counter()
                props_set = session.execute_write(_update_batch, batch)
                props_set_total += props_set
                processed += len(batch)
                if verbose and (batch_idx % progress_every == 0):
                    print(f"[name_search] batch #{batch_idx} "
                          f"size={len(batch)} processed={processed}/{total} "
                          f"props_set={props_set} elapsed={time.perf_counter()-t_b0:.2f}s")
                batch.clear()

        # 尾批
        if batch:
            batch_idx += 1
            t_b0 = time.perf_counter()
            props_set = session.execute_write(_update_batch, batch)
            props_set_total += props_set
            processed += len(batch)
            if verbose:
                print(f"[name_search] batch #{batch_idx} (final) "
                      f"size={len(batch)} processed={processed}/{total} "
                      f"props_set={props_set} elapsed={time.perf_counter()-t_b0:.2f}s")
            batch.clear()

        if verbose:
            print(f"[name_search] DONE. processed={processed}, props_set_total={props_set_total}, "
                  f"total_elapsed={time.perf_counter()-t0:.2f}s")

# ===== CLI / 入口函数 =====
def initialize():
    """
    一次性跑完三步预处理。
    """
    driver = get_neo4j_driver()
    try:
        #updated = populate_member_fqn(driver)
        #print(f"populate_member_fqn updated={updated}")

        labels = ["File", "Class", "Annotation", "Enum", "Field",
                  "Interface", "Method", "Package", "Record"]
        populate_module_explaination_for_labels(driver, labels)

        #populate_name_search_for_all_nodes(driver)
    finally:
        driver.close()

if __name__ == "__main__":
    initialize()
