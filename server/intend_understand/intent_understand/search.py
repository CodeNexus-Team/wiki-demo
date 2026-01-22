# search.py
from __future__ import annotations
from typing import Dict, Any, List, Optional, Tuple

from collections import defaultdict
from openai import OpenAI

from utils import (
    get_neo4j_driver,
    OPENAI_BASE_URL,
    _boost,
    _escape_lucene,
    _dedup_keep_order,
    _name_to_search_text,
)

OPENAI_MODEL = "text-embedding-3-small"
NODE_LABELS = ["Block","File","Class","Annotation","Enum","Field","Interface","Method","Package","Record"]

# === 全局 Neo4j driver / OpenAI client（简单做模块级单例） ===
driver = get_neo4j_driver()
openai_client = OpenAI(base_url=OPENAI_BASE_URL)

# === 嵌入向量缓存，避免重复调用 OpenAI API ===
_embedding_cache: Dict[str, List[float]] = {}

def clear_embedding_cache() -> None:
    """清空嵌入向量缓存"""
    global _embedding_cache
    _embedding_cache.clear()

def _effective_labels(labels: Optional[List[str]]) -> List[str]:
    """返回实际要用的标签列表；[] 则直接返回空（表示不搜）。"""
    if labels is None:
        return NODE_LABELS
    # 去重并保持原大小写（Neo4j label 大小写敏感，按你库里实际为准）
    seen, out = set(), []
    for l in labels:
        if l not in seen:
            out.append(l); seen.add(l)
    return out
def search_fulltext(query: str, k: int, prop: str, labels: Optional[List[str]] = None):
    """
    用全文索引返回最匹配的前 k 个节点，按 labels 过滤（不传则用 NODE_LABELS）。
    prop ∈ {'name', 'module_explaination', 'SE_Why', 'SE_When', 'SE_How'}
    依赖索引：
      - name_search_index_english (ON n.name_search)
      - explanation_index_cjk     (ON n.module_explaination)
      - se_why_index_cjk          (ON n.SE_Why)
      - se_when_index_cjk         (ON n.SE_When)
      - se_how_index_cjk          (ON n.SE_How)
    """
    if k <= 0:
        return []

    valid_props = ("name", "module_explaination", "SE_Why", "SE_When", "SE_How")
    if prop not in valid_props:
        raise ValueError(f"prop 必须为 {valid_props} 之一")

    eff_labels = _effective_labels(labels)
    if not eff_labels:
        return []

    if prop == "name":
        index_name = "name_search_index_english"
    elif prop == "module_explaination":
        index_name = "explanation_index_cjk"
    elif prop == "SE_Why":
        index_name = "se_why_index_cjk"
    elif prop == "SE_When":
        index_name = "se_when_index_cjk"
    else:  # "SE_How"
        index_name = "se_how_index_cjk"

    cypher = """
    CALL db.index.fulltext.queryNodes($index_name, $q) YIELD node, score
    WITH node, score
    WHERE any(l IN labels(node) WHERE l IN $labels)
    RETURN
      labels(node)        AS labels,
      elementId(node)     AS id,
      node.name           AS name,
      node.fully_qualified_name AS full_name,
      node.module_explaination  AS explaination,
      score
    ORDER BY score DESC
    LIMIT $k
    """

    with driver.session(database="neo4j") as session:
        rows = session.run(
            cypher,
            index_name=index_name,
            q=query,
            k=k,
            prop=prop,
            labels=eff_labels
        ).data()
    return rows

def search_vector(query: str, k: int, prop: str, labels: Optional[List[str]] = None):
    """
    用向量索引返回最匹配的前 k 个节点；只在指定 labels 的索引上查询（不传则用 NODE_LABELS）。
    prop ∈ {'name', 'module_explaination', 'SE_Why', 'SE_When', 'SE_How'}
    依赖（每个标签一个索引）:
      - name_embedding_{label.lower()}
      - explaination_embedding_{label.lower()}
      - why_embedding_{label.lower()}
      - when_embedding_{label.lower()}
      - how_embedding_{label.lower()}
    """
    if k <= 0:
        return []

    valid_props = ("name", "module_explaination", "SE_Why", "SE_When", "SE_How")
    if prop not in valid_props:
        raise ValueError(f"prop 必须为 {valid_props} 之一")

    eff_labels = _effective_labels(labels)
    if not eff_labels:
        return []

    # 1) 生成查询向量（使用缓存避免重复计算）
    if query in _embedding_cache:
        emb = _embedding_cache[query]
    else:
        emb = openai_client.embeddings.create(model=OPENAI_MODEL, input=[query]).data[0].embedding
        _embedding_cache[query] = emb

    # 2) 逐标签查询，对每个标签各取 k，然后在 Python 合并再裁剪
    results = []
    with driver.session(database="neo4j") as session:
        for label in eff_labels:
            if prop == "name":
                index_name = f"name_embedding_{label.lower()}"
            elif prop == "module_explaination":
                index_name = f"explaination_embedding_{label.lower()}"
            elif prop == "SE_Why":
                index_name = f"why_embedding_{label.lower()}"
            elif prop == "SE_When":
                index_name = f"when_embedding_{label.lower()}"
            else:  # "SE_How"
                index_name = f"how_embedding_{label.lower()}"

            cypher = """
            CALL db.index.vector.queryNodes($index_name, $k, $embedding)
            YIELD node, score
            RETURN
              labels(node)        AS labels,
              elementId(node)     AS id,
              node.name           AS name,
              node.fully_qualified_name AS full_name,
              node.module_explaination  AS explaination,
              score
            """
            try:
                rows = session.run(
                    cypher,
                    index_name=index_name,
                    k=k,
                    embedding=emb,
                    prop=prop
                ).data()
                results.extend(rows)
            except Exception:
                # 某个标签可能未建该向量索引，安全跳过
                continue

    results.sort(key=lambda r: r["score"], reverse=True)
    return results[:k]
from collections import defaultdict

def _merge_lists_by_position(
    lists: List[List[IndexItem]],
    k: int
) -> List[IndexItem]:
    """
    将同一语言、来自不同索引的若干列表合并：
    - 按 (k - r) 计分并累加
    - 依据 id 去重
    - 按总分降序
    """
    node_payload: Dict[str, Dict[str, Any]] = {}
    score_map: Dict[str, float] = defaultdict(float)

    for lst in lists:
        _accumulate_scores_from_list(lst, k, score_map)  # 下文会稍微改下它支持 float

        for node in lst:
            node_id = node.get("id")
            if node_id is None:
                continue
            if node_id not in node_payload:
                node_payload[node_id] = {}
            _merge_node_payload(node_payload[node_id], node)

    merged = []
    for node_id, payload in node_payload.items():
        merged.append({
            "id": node_id,
            "labels": payload.get("labels", []),
            "name": payload.get("name", ""),
            "explaination": payload.get("explaination", ""),
            "full_name": payload.get("full_name", ""),
            "score": score_map.get(node_id, 0.0),
        })

    merged.sort(key=lambda x: (-x["score"], x.get("name", "")))
    return merged

# ===== 2) 关键词 -> Lucene / embedding 文本 =====

def build_fulltext_query_from_keywords(kw: Dict[str, Any], lang: str) -> str:
    """
    lang: 'cn' 或 'en'
    返回一个 Lucene 查询串，可直接喂给 search_fulltext 的 query 参数。
    要求：
      - 英文：统一用 _name_to_search_text 清洗，最终只保留空格分词；不再使用 + * 等符号。
      - 中文：保持原来的短语 + boost 形式。
    """
    assert lang in ('cn', 'en'), "lang 必须是 'cn' 或 'en'"

    terms_with_boost: List[Tuple[str, float]] = []

    # 1) coarse / fine
    for level in ('coarse', 'fine'):
        items = kw.get(level, {}).get(lang, []) or []
        for it in items:
            term = (it.get('term') or '').strip()
            if not term:
                continue
            b = _boost(it.get('score', 0.5), base=1.2, span=3.8)
            terms_with_boost.append((term, b))

    # 2) synonyms
    syn = kw.get('synonyms', {}).get(lang, {}) or {}
    for _, syn_list in syn.items():
        for it in syn_list or []:
            term = (it.get('term') or '').strip()
            if not term:
                continue
            b = _boost(it.get('score', 0.5), base=1.0, span=3.0)
            terms_with_boost.append((term, b))

    # 3) guessed_paths（目录/文件名）——仅英文分支启用
    if lang == 'en':
        gp = kw.get('guessed_paths', {}) or {}
        for it in gp.get('directories', []) or []:
            t = (it.get('term') or '').strip().strip('"')
            if t:
                b = _boost(it.get('score', 0.5), base=1.0, span=3.0)
                terms_with_boost.append((t, b))
        for it in gp.get('files', []) or []:
            t = (it.get('term') or '').strip().strip('"')
            if t:
                b = _boost(it.get('score', 0.5), base=1.4, span=3.6)
                terms_with_boost.append((t, b))

    # 去重（同词取最大权）
    agg: Dict[str, float] = {}
    for t, b in terms_with_boost:
        agg[t] = max(agg.get(t, 0), b)

    clauses: List[str] = []
    for raw_t, b in agg.items():
        if lang == 'cn':
            # 中文：仍用短语 + boost
            clauses.append(f"(\"{_escape_lucene(raw_t)}\")^{b}")
        else:
            # 英文：统一用 _name_to_search_text，去除一切特殊符号，只保留空格分词
            norm = _name_to_search_text(raw_t)
            if not norm:  # 清洗后可能为空
                continue
            # 不加引号/加号/星号，仅用空格分词；保留外层括号和 boost
            # 例如： (coupon count equal to)^3.4
            clauses.append(f"({norm})^{b}")

    # 多个子句 OR 连接
    q = " OR ".join([f"({c})" for c in _dedup_keep_order(clauses)]) or ""
    return q or "*"

def build_embedding_text_from_keywords(kw: Dict[str, Any], lang: str) -> str:
    """
    把结构化关键词打平成一个“带权文本”，用于 search_vector 的 query。
    英文关键词一律用 _name_to_search_text 规范化（只保留空格分词）。
    """
    assert lang in ('cn', 'en')
    buckets: List[Tuple[str, float]] = []

    def _collect(items, base=1.0, span=4.0):
        for it in items or []:
            t = (it.get('term') or '').strip()
            if not t:
                continue
            buckets.append((t, _boost(it.get('score', 0.5), base=base, span=span)))

    _collect(kw.get('coarse', {}).get(lang, []), base=1.2, span=3.8)
    _collect(kw.get('fine', {}).get(lang, []),   base=1.1, span=3.4)

    syn = kw.get('synonyms', {}).get(lang, {}) or {}
    for _, syn_list in syn.items():
        _collect(syn_list, base=1.0, span=3.0)

    gp = kw.get('guessed_paths', {}) or {}
    _collect(gp.get('directories', []), base=0.9, span=2.6)
    _collect(gp.get('files', []),       base=1.2, span=3.6)

    # 去重后“按权重重复”
    agg: Dict[str, float] = {}
    for t, w in buckets:
        agg[t] = max(agg.get(t, 0.0), w)

    pieces: List[str] = []

    for raw_t, w in agg.items():
        reps = max(1, min(5, int(round(w))))  # 1~5 次
        if lang == 'en':
            # 英文：先规范化到空格分词，再逐 token 重复
            norm = _name_to_search_text(raw_t)
            if not norm:
                continue
            toks = norm.split()
            if not toks:
                continue
            for tok in toks:
                pieces.extend([tok] * reps)
        else:
            # 中文：原样重复
            pieces.extend([raw_t] * reps)

    # 英文不再额外做驼峰/下划线拆分（已由 _name_to_search_text 统一处理）
    return " ; ".join(pieces)

def query_from_keyword_result(kw: Dict[str, Any], lang: str, k: int = 20,
                              labels: Optional[List[str]] = None):
    if lang == 'cn':
        # ====== 中文：用更多索引（What + Why + When + How） ======
        q = build_fulltext_query_from_keywords(kw, 'cn')
        print(q)
        t = build_embedding_text_from_keywords(kw, 'cn')

        # fulltext: module_explaination + SE_Why/When/How
        ft_lists: List[List[IndexItem]] = []
        ft_lists.append(search_fulltext(q, k, 'module_explaination', labels=labels))

        # 这里可以给 Why/When/How 稍微小一点的 k（例如 k//2），防止每个 index 都拉太多
        aux_k = max(1, k )
        for prop in ('SE_Why', 'SE_When', 'SE_How'):
            ft_lists.append(search_fulltext(q, aux_k, prop, labels=labels))

        ft_merged = _merge_lists_by_position(ft_lists, k)

        # vector: 对应 4 套向量索引
        vt_lists: List[List[IndexItem]] = []
        vt_lists.append(search_vector(t, k, 'module_explaination', labels=labels))
        for prop in ('SE_Why', 'SE_When', 'SE_How'):
            vt_lists.append(search_vector(t, aux_k, prop, labels=labels))

        vt_merged = _merge_lists_by_position(vt_lists, k)

        return {"fulltext": ft_merged, "vector": vt_merged, "query_kw": q}

    else:
        # ====== 英文：保持原逻辑，只用 name 相关索引 ======
        q = build_fulltext_query_from_keywords(kw, 'en')
        print(q)
        ft = search_fulltext(q, k, 'name', labels=labels)
        t = build_embedding_text_from_keywords(kw, 'en')
        vt = search_vector(t, k, 'name', labels=labels)
        return {"fulltext": ft, "vector": vt, "query_kw": q}


# ===== 3) EN/CN 结果合并 =====
IndexItem = Dict[str, Any]
SearchBundle = Dict[str, List[IndexItem]]

def _accumulate_scores_from_list(
    items: List[IndexItem],
    k: int,
    score_map: Dict[str, float],
    weight: float = 1.0,
) -> None:
    """
    对单个检索列表按位置计分: 第 r 名得分 = weight * (k - r)
    """
    for idx, node in enumerate(items):
        r = idx + 1
        gain = weight * max(k - r, 0)
        if gain <= 0:
            continue
        node_id = node.get("id")
        if node_id is None:
            continue
        score_map[node_id] += gain


def _merge_node_payload(dest: Dict[str, Any], src: Dict[str, Any]) -> None:
    """
    合并节点展示信息。优先保留已存在字段；若缺失则用新值补全。
    只关心：id, labels, name, explaination,full_name
    """
    for key in ("id", "labels", "name", "explaination","full_name"):
        if key not in dest or dest[key] in (None, "", []):
            if key in src:
                dest[key] = src[key]
def merge_and_rank_index_results(
    results_en: SearchBundle,
    results_cn: SearchBundle,
    k: int,
    cn_weight: float = 1.2,   # 默认让中文贡献稍微大一点
) -> List[Dict[str, Any]]:
    """
    将英文与中文两次调用的结果(各含 fulltext / vector)合并：
    - 依据 id 去重
    - 采用位置分 (k - r)，中文分数乘以 cn_weight
    - 按总分降序
    """
    node_payload: Dict[str, Dict[str, Any]] = {}
    score_map: Dict[str, float] = defaultdict(float)

    en_lists = [
        results_en.get("fulltext", []) or [],
        results_en.get("vector", []) or [],
    ]
    cn_lists = [
        results_cn.get("fulltext", []) or [],
        results_cn.get("vector", []) or [],
    ]

    # 英文：权重 1.0
    for lst in en_lists:
        _accumulate_scores_from_list(lst, k, score_map, weight=1.0)

    # 中文：权重 cn_weight（例如 1.2 ~ 1.5 可自行调）
    for lst in cn_lists:
        _accumulate_scores_from_list(lst, k, score_map, weight=cn_weight)

    # 合并展示字段
    for lst in en_lists + cn_lists:
        for node in lst:
            node_id = node.get("id")
            if node_id is None:
                continue
            if node_id not in node_payload:
                node_payload[node_id] = {}
            _merge_node_payload(node_payload[node_id], node)

    merged: List[Dict[str, Any]] = []
    for node_id, payload in node_payload.items():
        merged.append({
            "id": node_id,
            "labels": payload.get("labels", []),
            "name": payload.get("name", ""),
            "explaination": payload.get("explaination", ""),
            "full_name": payload.get("full_name", ""),
            "score": score_map.get(node_id, 0.0),
        })

    merged.sort(key=lambda x: (-x["score"], x.get("name", "")))

    index_hits: List[Dict[str, Any]] = [
        {
            "id": m["id"],
            "labels": m["labels"],
            "name": m["name"],
            "full_name": m.get("full_name", ""),
            "explaination": m["explaination"],
            # "score": m["score"],  # 需要的话也可以露给上游
        }
        for m in merged
    ]
    return index_hits

# ===== 4) 从 clarified_queries 构造关键词 =====
_DEFAULT_JAVA_LABELS = [
    "Class","Interface","Enum","Record","Annotation",
    "Method","Field","File","Package","Directory","Block"
]

def _build_keywords_from_q(q: Dict[str, Any]) -> Dict[str, Any]:
    """
    将 Q 中的 search_keywords_cn / search_keywords_en / detail_name
    规整为关键词规范结构，适配 build_fulltext_query_from_keywords / build_embedding_text_from_keywords：
    {
      "coarse": {"cn": [ {"term": "..."} ], "en": [ {"term": "..."} ]},
      "fine":   {"cn": [ {"term": "..."} ], "en": [ {"term": "..."} ]},
      "synonyms": {"cn": { base_term: [ {"term": "..."} ] }, "en": { ... }},
      "meta": {...}
    }
    说明：
    - 细粒度优先放在 fine.*；
    - 若存在 detail_name（通常是 FQN/类名），一并加入 fine.en（并打更高的初始得分）；
    - 任何字符串项会被包装为 {"term": s, "score": 1.0}（detail_name 用 1.2）。
    """

    def _norm_terms(x, default_score: float = 1.0):
        """把 str / dict / 混合列表规整为 [{'term': str, 'score': float}, ...]。"""
        out = []
        if x is None:
            return out
        if isinstance(x, dict):
            # 若已是 dict(可能含 term/score)，确保有 term
            term = (x.get("term") or "").strip()
            if term:
                score = float(x.get("score", default_score))
                out.append({"term": term, "score": score})
            return out
        if isinstance(x, str):
            s = x.strip()
            if s:
                out.append({"term": s, "score": default_score})
            return out
        if isinstance(x, (list, tuple)):
            for it in x:
                if isinstance(it, dict):
                    term = (it.get("term") or "").strip()
                    if term:
                        score = float(it.get("score", default_score))
                        out.append({"term": term, "score": score})
                elif isinstance(it, str):
                    s = it.strip()
                    if s:
                        out.append({"term": s, "score": default_score})
        return out

    cn_terms = _norm_terms(q.get("search_keywords_cn"), default_score=1.0)
    en_terms = _norm_terms(q.get("search_keywords_en"), default_score=1.0)

    # detail_name 常为英文 FQN/类名，加入 fine.en，并给予略高权重
    detail_names = _norm_terms(q.get("detail_name"), default_score=1.2)

    # 组装为你的关键词抽取器可接受的结构
    keywords = {
        "coarse": {
            "cn": [],  # 这里先留空；如有需要可把部分高层词丢到 coarse
            "en": [],
        },
        "fine": {
            "cn": cn_terms,
            "en": en_terms,  # 把 detail_name 合并到英文细粒度
        },
        "synonyms": {
            "cn": {},  # 若后续需要，可以把一些近义词映射到这里
            "en": {},
        },
        "meta": {
            "query": q.get("query", ""),
            "id": q.get("id", ""),
            # 可选：把 why/evidence 也带上，若你的 build_* 会拼入 embedding
            "why": q.get("why", ""),
            # "evidence": q.get("evidence", None),
        },
    }
    return keywords

def _effective_labels_from_q(q: Dict[str, Any]) -> List[str]:
    """
    从 Q 的 targets 推导要检索的 labels；为空/缺失时回退默认 Java 标签。
    同时保证去重与顺序稳定。
    """
    targets = q.get("targets") or []
    if not isinstance(targets, list) or not targets:
        return _DEFAULT_JAVA_LABELS[:]
    seen, out = set(), []
    for t in targets:
        if t and t not in seen:
            out.append(t); seen.add(t)
    return out

from typing import Dict, Any, List, Optional

def multi_label_merged_index_hits(
    keywords: Dict[str, Any],
    labels: List[str],
    k: int,
) -> Dict[str, Any]:
    """
    对每个 label_x 独立执行一次：
        results_cn = query_from_keyword_result(keywords, 'cn', k, [label_x])
        results_en = query_from_keyword_result(keywords, 'en', k, [label_x])
        index_hits_x = merge_and_rank_index_results(results_en, results_cn, k)
          -> index_hits_x 是 List[Dict[...]]，而不是 dict

    然后将每个 label 得到的 index_hits_x 简单拼接成一个大的列表。
    为了保持你现在想要的返回结构，返回：
        {
            "fulltext": [... 所有 label 的 index_hits 合并 ...],
            "vector":   [... 所有 label 的 index_hits 合并 ...],
            "query_kw": "..."  # 统一用一份（这里取第一次中文查询的 query_kw）
        }

    注意：这里的 "fulltext" / "vector" 都是 index_hits 列表，
    本质是同一批节点，只是为了对齐你现在的外层结构。
    """
    eff_labels = _effective_labels(labels) if labels else []
    if not eff_labels:
        return {"fulltext": [], "vector": [], "query_kw": ""}

    merged_fulltext: List[Dict[str, Any]] = []
    merged_vector: List[Dict[str, Any]] = []
    unified_query_kw: Optional[str] = None

    for idx, lbl in enumerate(eff_labels):
        # 每个 label 独立跑一套查询
        results_cn = query_from_keyword_result(keywords, 'cn', k, [lbl])
        results_en = query_from_keyword_result(keywords, 'en', k, [lbl])

        # 只在第一次循环时记录一份 query_kw（中文或英文都行，这里取中文）
        if unified_query_kw is None:
            unified_query_kw = results_cn.get("query_kw", "")

        # 对该 label 做 EN+CN 的 merge ranking
        index_hits = merge_and_rank_index_results(results_en, results_cn, k)
        # index_hits 是 List[Dict]，不能 .get

        # 简单拼接：保留每个 label 内部的排序，不做跨 label 的再排序
        merged_fulltext.extend(index_hits)
        merged_vector.extend(index_hits)

    return {
        "fulltext": merged_fulltext,
        "vector": merged_vector,
        "query_kw": unified_query_kw or "",
    }

from typing import Dict, Any, List, Optional

def search_for_each_Q(
    expand_result: Dict[str, Any],
    search_num: int = 10,
    must_labels: Optional[List[str]] = None,   # 每个 Q 至少要包含的 labels
    only_labels: Optional[List[str]] = None,   # 若非空，强制使用这一组 labels
) -> List[Dict[str, Any]]:
    """
    输入：expand_user_query(...) 的输出（含 clarified_queries 数组）
    输出：按每个 Q 的检索与合并结果列表。
    返回列表中的每项结构：
    {
      "q_meta": { "id": ..., "query": ..., "targets": [...], "relations": [...], "task_type": ..., "query_range": ... },
      "labels": [...],   # 实际用于检索的 labels
      "merged":  [...],  # multi_label_merged_index_hits 合并后的结果列表（已按名次计分规则排序）
    }

    参数:
      - search_num: 每个 label 的 top-k
      - must_labels: 每个 Q 的 labels 中一定要包含的标签列表；
                     若不在 Q.targets 中，则会 append 进去（去重）。
      - only_labels: 若非空，则所有 Q 都只使用该列表作为 labels，
                     不再考虑 Q.targets / must_labels。
    """
    clarified = expand_result.get("clarified_queries") or []
    out: List[Dict[str, Any]] = []

    # 预处理 must_labels（去重保序）
    must_labels = must_labels or []
    seen_ml = set()
    must_labels_clean: List[str] = []
    for l in must_labels:
        if l and l not in seen_ml:
            must_labels_clean.append(l)
            seen_ml.add(l)

    # 预处理 only_labels（去重保序）
    only_labels = only_labels or []
    seen_ol = set()
    only_labels_clean: List[str] = []
    for l in only_labels:
        if l and l not in seen_ol:
            only_labels_clean.append(l)
            seen_ol.add(l)

    for q in clarified:
        # 1) 构造 keywords（最小可用）
        kw = _build_keywords_from_q(q)

        # 2) 决定本 Q 实际使用的 labels
        if only_labels_clean:
            # 若指定了 only_labels，则直接使用它，忽略 targets 和 must_labels
            labels = only_labels_clean[:]   # 拷贝一份，避免被修改
        else:
            # 否则：先用 Q.targets 推出 labels
            labels = _effective_labels_from_q(q)

            # 然后确保包含 must_labels 中的全部元素
            if must_labels_clean:
                existing = set(labels)
                for l in must_labels_clean:
                    if l not in existing:
                        labels.append(l)
                        existing.add(l)

        # 3) 使用 multi_label_merged_index_hits 统一完成检索：
        merged_bundle = multi_label_merged_index_hits(kw, labels, search_num)

        # 这里保持原有接口：merged 依然是“结果列表”
        merged_hits = merged_bundle.get("fulltext", []) or []

        # 4) 组织返回
        out.append({
            "q_meta": {
                "id": q.get("id"),
                "query": q.get("query"),
                "why": q.get("why"),
                "task_type": q.get("task_type"),
                "query_range": q.get("query_range"),
                "targets": q.get("targets"),
                "relations": q.get("relations"),
            },
            "labels": labels,  # 最终对这个 Q 使用的 labels
            # "index_bundle": merged_bundle,  # 如后面需要调试可打开
            "merged": merged_hits,
        })

    return out

from typing import Dict, Any, List, Optional

def search_for_each_Q_all_labels(
    expand_result: Dict[str, Any],
    search_num: int = 10,
    must_labels: Optional[List[str]] = None,   # 新增：每个 Q 至少要包含的 labels
    only_labels: Optional[List[str]] = None,   # 新增：若非空，强制使用这一组 labels
) -> List[Dict[str, Any]]:
    """
    输入：expand_user_query(...) 的输出（含 clarified_queries 数组）
    输出：按每个 Q 的检索与合并结果列表。
    返回列表中的每项结构：
    {
      "q_meta": { "id": ..., "query": ..., "targets": [...], "relations": [...], "task_type": ..., "query_range": ... },
      "labels": [...],                 # 实际用于检索的 labels
      "merged":  [...],                # 合并后的结果列表（已按名次计分规则排序）
    }

    参数：
      - search_num: 每个 Q 的 top-k
      - must_labels: 每个 Q 的 labels 中一定要包含的标签列表；
                     若不在 Q.targets 推导出的 labels 中，则会 append 进去（去重）。
      - only_labels: 若非空，则所有 Q 都只使用该列表作为 labels，
                     不再考虑 Q.targets / must_labels。
    """
    clarified = expand_result.get("clarified_queries") or []
    out: List[Dict[str, Any]] = []

    # 预处理 must_labels（去重保序）
    must_labels = must_labels or []
    seen_ml = set()
    must_labels_clean: List[str] = []
    for l in must_labels:
        if l and l not in seen_ml:
            must_labels_clean.append(l)
            seen_ml.add(l)

    # 预处理 only_labels（去重保序）
    only_labels = only_labels or []
    seen_ol = set()
    only_labels_clean: List[str] = []
    for l in only_labels:
        if l and l not in seen_ol:
            only_labels_clean.append(l)
            seen_ol.add(l)

    for q in clarified:
        # 1) 构造 keywords（最小可用）
        kw = _build_keywords_from_q(q)

        # 2) 确定本 Q 使用的 labels
        if only_labels_clean:
            # 强制使用 only_labels，忽略 Q.targets 和 must_labels
            labels = only_labels_clean[:]
        else:
            # 基于 Q.targets 计算
            labels = _effective_labels_from_q(q)

            # 确保包含 must_labels
            if must_labels_clean:
                existing = set(labels)
                for l in must_labels_clean:
                    if l not in existing:
                        labels.append(l)
                        existing.add(l)

        # 可选：如果你想强制加 Block，可以在这里：
        # labels.append("Block")

        # 3) 执行检索：中英文各一套
        raw_cn = query_from_keyword_result(kw, 'cn', search_num, labels)
        raw_en = query_from_keyword_result(kw, 'en', search_num, labels)

        # 4) 合并与排名（使用你已有的合并函数）
        merged_hits = merge_and_rank_index_results(raw_en, raw_cn, search_num)

        # 5) 组织返回
        out.append({
            "q_meta": {
                "id": q.get("id"),
                "query": q.get("query"),
                "why": q.get("why"),
                "task_type": q.get("task_type"),
                "query_range": q.get("query_range"),
                "targets": q.get("targets"),
                "relations": q.get("relations"),
            },
            "labels": labels,   # 最终使用的 labels（已考虑 must/only）
            "merged": merged_hits,
        })

    return out

# ===== 6) （可选）全局汇总 per_q_results 的辅助函数 =====
def aggregate_per_q_results_mixed_label(
    per_q_results: List[Dict[str, Any]]
) -> List[Dict[str, Any]]:
    """
    只按 Q 轮询聚合，不再按 label 分桶。
    - 保持每个 Q 内部的顺序（即 merged 列表中的顺序）；
    - 第 1 轮：依次取 Q1 的第 1 个、Q2 的第 1 个、...；
      第 2 轮：依次取 Q1 的第 2 个、Q2 的第 2 个、...；
      以此类推；
    - 全局用 id 去重，同一个节点只保留第一次出现；
    - 额外字段：
        - agg_global_rank: 聚合后全局排名（1 开始）
        - agg_q_rank: 在该 Q 中是第几个（1 开始，对应 merged 的位置）
        - source_q_id / source_q_query: 来源 Q 信息
    """

    aggregated: List[Dict[str, Any]] = []
    seen_ids = set()
    global_rank = 1

    # 各个 Q 的 merged 列表
    merged_lists: List[List[Dict[str, Any]]] = [
        (item.get("merged") or []) for item in per_q_results
    ]
    max_len = max((len(lst) for lst in merged_lists), default=0)

    # k 表示在单个 Q 内的“第 k 个命中”（k 从 0 开始，对应 agg_q_rank = k+1）
    for k in range(max_len):
        any_added_this_k = False

        for q_idx, q_item in enumerate(per_q_results):
            merged = merged_lists[q_idx]
            if k >= len(merged):
                continue

            hit = merged[k]
            hit_id = hit.get("id")
            if not hit_id or hit_id in seen_ids:
                continue

            new_hit = dict(hit)  # 拷贝一份，避免改动原始结构
            q_meta = q_item.get("q_meta", {}) or {}

            new_hit["agg_global_rank"] = global_rank
            new_hit["agg_q_rank"] = k + 1
            new_hit["source_q_id"] = q_meta.get("id")
            new_hit["source_q_query"] = q_meta.get("query")

            aggregated.append(new_hit)
            seen_ids.add(hit_id)
            global_rank += 1

    return aggregated
# 你刚刚让我写的 aggregate_per_q_results 也可以放这里（如果你需要）。
def aggregate_per_q_results(per_q_results: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    输入: per_q_results = search_for_each_Q(...) 的返回
    输出: 一个汇总后的大列表 agg_hits

    规则:
    - 先按 label 分桶；
    - 对于每个 label: q1 的第1名, q2 的第1名, ..., qN 的第1名,
      再 q1 的第2名, q2 的第2名, ... 周而复始；
    - 用 id 全局去重（同一个节点只保留第一次出现）；
    - 尽量保留原有 rank 信息，并额外提供:
        agg_label, agg_label_rank, agg_global_rank, source_q_id, source_q_query
    """

    # 1) 统计 label 的全局顺序（按照首次出现的顺序）
    label_order: List[str] = []
    for q_item in per_q_results:
        for lbl in q_item.get("labels", []) or []:
            if lbl not in label_order:
                label_order.append(lbl)

    aggregated: List[Dict[str, Any]] = []
    seen_ids = set()
    global_rank = 1
    # 记录每个 label 已经收了多少条，用来给 agg_label_rank 编号
    label_rank_counter: Dict[str, int] = {lbl: 0 for lbl in label_order}

    # 2) 按 label 依次做 round-robin 聚合
    for lbl in label_order:
        # 为当前 label 构造 “每个 q 的命中列表”
        per_q_lists: List[List[Dict[str, Any]]] = []
        for q_item in per_q_results:
            merged = q_item.get("merged", []) or []
            # 当前 q 对应此 label 的所有命中
            hits_for_label = [
                hit for hit in merged
                if lbl in (hit.get("labels") or [])
            ]
            # 按原始 rank 排一下，若缺失 rank 则放到后面
            hits_for_label.sort(key=lambda h: h.get("rank", 10**9))
            per_q_lists.append(hits_for_label)

        if not per_q_lists:
            continue

        max_len = max(len(lst) for lst in per_q_lists)
        if max_len == 0:
            continue

        # 轮询：第 1 名轮一圈，第 2 名轮一圈，...
        k = 0
        while k < max_len:
            for q_idx, lst in enumerate(per_q_lists):
                if k >= len(lst):
                    continue
                hit = lst[k]
                hit_id = hit.get("id")
                # 用 id 去重：如果之前已经加入过，就跳过
                if not hit_id or hit_id in seen_ids:
                    continue

                # 构造一个新的条目，避免修改原始 per_q_results
                new_hit = dict(hit)
                q_meta = per_q_results[q_idx].get("q_meta", {}) or {}

                label_rank_counter[lbl] += 1
                new_hit["agg_label"] = lbl
                new_hit["agg_label_rank"] = label_rank_counter[lbl]
                new_hit["agg_global_rank"] = global_rank
                new_hit["source_q_id"] = q_meta.get("id")
                new_hit["source_q_query"] = q_meta.get("query")

                aggregated.append(new_hit)
                seen_ids.add(hit_id)
                global_rank += 1

            k += 1

    return aggregated
