# main.py
from __future__ import annotations
from typing import Any, Dict, List, Optional
import json
from pprint import pprint
import os
import sys
from datetime import datetime  # 新增
from pathlib import Path

from expand_keyword import expand_user_keyword
from expand_query import expand_user_query
from search import (
    multi_label_merged_index_hits,
    search_for_each_Q,
    search_for_each_Q_all_labels,
    aggregate_per_q_results,
    aggregate_per_q_results_mixed_label,
    clear_embedding_cache
)

THIS_FILE = Path(__file__).resolve()
JAVA_WIKI_ROOT = THIS_FILE.parents[2]          # /home/frisk/CodeNexus/java_wiki
FILTER_DIR = JAVA_WIKI_ROOT / "cyf" / "filter" # /home/frisk/CodeNexus/java_wiki/cyf/filter
if str(FILTER_DIR) not in sys.path:
    sys.path.insert(0, str(FILTER_DIR))

from filter import filter_entities  # 对应 filter.py 里的函数名
from scope import analyze_scope
def run_pipeline(
    user_query: str,
    pre_search: bool = True,
    search_num: int = 20,
    must_labels: Optional[List[str]] = None,
    only_labels: Optional[List[str]] = None,
) -> None:
    # 结果目录准备
    result_dir = os.path.join(os.path.dirname(__file__), "..", "result")
    os.makedirs(result_dir, exist_ok=True)
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")

    # 1. 关键词扩展
    keywords = expand_user_keyword(user_query)
    print("=== [1] expand_user_keyword 输出 ===")
    pprint(keywords)

    # 1.1 确定预检索 Labels (省略部分代码，保持原样...)
    labels: List[str] = ["File", "Class", "Interface"]
    if isinstance(keywords, dict):
        tgt = keywords.get("target_labels") or []
        extracted = []
        tgt_list = tgt if isinstance(tgt, list) else []
        for item in tgt_list:
             if isinstance(item, dict):
                 lbl = item.get("label")
                 if lbl and lbl not in extracted: extracted.append(lbl)
        if extracted:
            labels = extracted
    if "Block" not in labels:
        labels.append("Block")
    
    # 2. 预检索 (省略部分代码，保持原样...)
    if pre_search:
        merged_hits_bundle = multi_label_merged_index_hits(keywords, labels, 5)
        cn_keywords = merged_hits_bundle.get("query_kw")
        index_hits_for_expand = merged_hits_bundle
        query_keywords_for_expand = cn_keywords
    else:
        index_hits_for_expand = ""
        query_keywords_for_expand = ""

    # 3. 拓展用户查询
    expand_out = expand_user_query(
        user_query,
        query_keywords=query_keywords_for_expand,
        index_hits=index_hits_for_expand,
    )
    
    # 3.1 保存原始拓展结果
    expanded_path = os.path.join(result_dir, f"{ts}_expanded_raw.json")
    with open(expanded_path, "w", encoding="utf-8") as f:
        json.dump(expand_out, f, ensure_ascii=False, indent=2)

    # ================= 交互选择逻辑 =================
    if not isinstance(expand_out, dict) or "categories" not in expand_out:
        print("错误：expand_user_query 返回格式异常，无法进行分类选择。")
        return

    categories = expand_out.get("categories", {})
    flat_questions = []
    cat_map = {
        "product_manager_questions": "产品经理 (Business)",
        "developer_questions": "开发者 (Implementation)",
        "beginner_questions": "初学者 (Structure)",
        "architect_questions": "架构师 (Architecture)"
    }

    print("\n" + "="*50)
    print("请从以下扩展问题中选择你需要查询的 (输入序号，逗号分隔):")
    print("="*50)

    global_idx = 1
    for cat_key, question_list in categories.items():
        if not question_list: continue
        cat_display = cat_map.get(cat_key, cat_key)
        print(f"\n--- {cat_display} ---")
        for q in question_list:
            q["_category_source"] = cat_key 
            flat_questions.append(q)
            print(f"[{global_idx}] {q.get('query')} (ID: {q.get('id')})")
            global_idx += 1

    print("\n" + "-"*50)
    user_input = input("请输入序号 (例如 1,3,4) 或直接回车全选: ").strip()
    
    selected_questions = []
    if not user_input:
        selected_questions = flat_questions
    else:
        try:
            indices = [int(i.strip()) for i in user_input.split(",") if i.strip().isdigit()]
            for idx in indices:
                if 1 <= idx <= len(flat_questions):
                    selected_questions.append(flat_questions[idx-1])
        except Exception as e:
            print(f"输入解析错误: {e}，将使用全部问题。")
            selected_questions = flat_questions

    if not selected_questions:
        print("未选中任何问题，流程结束。")
        return

    print(f"\n已选中 {len(selected_questions)} 个问题。")

    # ============================================================
    # [新增逻辑 START] 调用 Scope Analysis
    # ============================================================
    print("\n=== [3.5] 正在执行 Scope 分析 (analyze_scope) ===")
    
    # 1. 提取 query 文本列表
    expanded_query_strings = [q.get("query", "") for q in selected_questions if q.get("query")]
    
    # 2. 调用外部函数
    # user_query: 原始查询
    # expanded_query_strings: 用户选中的意图
    try:
        scope_results = analyze_scope(user_query, expanded_query_strings)
        print(f">> Scope 分析结果: {scope_results}")
    except Exception as e:
        print(f"!! Scope 分析失败 (非阻断错误): {e}")
        scope_results = ["unknown"]

    # ============================================================
    # [新增逻辑 END]
    # ============================================================

    # 3.2 构造适配旧版接口的数据结构
    selected_payload = {
        "clarified_queries": selected_questions,
        "user_query": user_query,
        "followup_questions": expand_out.get("followup_questions", []),
        "analyzed_scopes": scope_results  # <--- 将 scope 结果存入 payload
    }

    # 3.3 保存用户选中及 Scope 分析结果
    selected_path = os.path.join(result_dir, f"{ts}_selected.json")
    with open(selected_path, "w", encoding="utf-8") as f:
        json.dump(selected_payload, f, ensure_ascii=False, indent=2)
    print(f">> 用户选中及Scope分析已保存: {selected_path}")

    # 4. 对选中的子问题执行检索
    per_q_results = search_for_each_Q_all_labels(
        selected_payload,
        search_num=search_num,
        must_labels=must_labels,
        only_labels=only_labels,
    )
    print("=== [4] 每个 Q 的检索结果 (Summary) ===")
    
    # --- 修复代码 START ---
    # per_q_results 是一个列表，列表项结构: {"q_meta": {...}, "merged": [...], "labels": [...]}
    if isinstance(per_q_results, list):
        for item in per_q_results:
            # 安全获取 ID，如果没有则显示 Unknown
            q_meta = item.get("q_meta", {})
            q_id = q_meta.get("id", "Unknown_ID")
            
            # 获取结果数量
            merged_list = item.get("merged", [])
            count = len(merged_list)
            
            print(f"  - {q_id}: found {count} entities")
    else:
        # 防御性代码：如果未来函数改回返回字典
        print(f"Warning: per_q_results is not a list, it is {type(per_q_results)}")
    # --- 修复代码 END ---

    # 5. 聚合结果
    agg_hits = aggregate_per_q_results_mixed_label(per_q_results)

    # 最终结果输出
    out_path = os.path.join(result_dir, f"{ts}_result.json")
    out_payload = {
        "user_query": user_query,
        "analyzed_scopes": scope_results, # <--- 最终结果也带上 scope
        "selected_queries_count": len(selected_questions),
        "entities": agg_hits,
    }

    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(out_payload, f, ensure_ascii=False, indent=2)
    print(f">> 聚合结果已写入: {out_path}")

    # 6. Filter 阶段
    print(f"\n=== [6] 开始执行 Filter (LLM筛选) ===")
    filtered_entities = filter_entities(user_query, agg_hits)

    print(f"筛选完成！保留 Entities: {len(filtered_entities)}")
    print("筛选结果预览：")
    for i, entity in enumerate(filtered_entities[:5], 1):
        print(f"{i}. {entity.get('name', 'N/A')} ({entity.get('agg_label', 'N/A')})")

    # 写入 Filter 结果
    filter_out_path = os.path.join(result_dir, f"{ts}_filter.json")
    filter_payload = {
        "user_query": user_query,
        "analyzed_scopes": scope_results, # <--- 过滤结果也带上 scope
        "base_data_file": out_path,
        "filtered_entities": filtered_entities,
    }
    with open(filter_out_path, "w", encoding="utf-8") as f:
        json.dump(filter_payload, f, ensure_ascii=False, indent=2)
    
    print(f">> 最终筛选结果已写入: {filter_out_path}")


if __name__ == "__main__":
    user_queries = [
        # "代码中与订单提交有关的逻辑有哪些？",
        "代码库中判断用户使用的优惠券是否生效的接口有哪些?",
        # "代码库中判断订单交易是否顺利完成的逻辑有哪些？",
        # "代码库中控制订单价格的逻辑有哪些？",
        # "代码库中与商品种类有关的代码有哪些？",
    ]

    # 根据需要切换 pre_search 的模式
    PRE_SEARCH = True

    for uq in user_queries:
        print(f"\n============================")
        print(f"Running pipeline for: {uq}")
        print(f"============================\n")

        # 示例：如果需要指定必须包含某些 labels，可以这样传：
        # run_pipeline(uq, pre_search=PRE_SEARCH, must_labels=["Class", "Method"])

        # 示例：如果需要指定只能包含某些 labels，可以这样传：
        # run_pipeline(uq, pre_search=PRE_SEARCH, only_labels=["File"])


        run_pipeline(uq, pre_search=PRE_SEARCH,search_num=20)