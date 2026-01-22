# expand_query.py
from __future__ import annotations
from typing import Any, Dict, Union, Optional

import json
from langchain.prompts import PromptTemplate
from langchain.schema import StrOutputParser

from .utils import get_llm, get_root_info, to_json_str

_llm = get_llm()

QUERY_EXPAND_PROMPT = PromptTemplate(
    input_variables=["user_query", "root_info", "query_keywords", "index_hits"],
    template=r"""
你是一个面向“代码知识图谱（Neo4j; Java 项目）”的检索意图扩展器。
【重要】本图谱以 **Java** 为主（.java），节点与关系如下，仅能使用其内的取值。
【图谱结构说明（Java 版）】
- 节点（labels）：
  - Block：模块/子系统的抽象汇总,一个Block可能包含多个子Block和子文件。
  - Package：Java 包（如 `com.example.cache`）。
  - File：源文件（`.java`）。
  - Class：类；Interface：接口；Enum：枚举；Record：记录类；Annotation：注解类型。
  - Method：方法；Field：字段。
- 关系：
  - ANNOTATES（注解应用），CALLS（方法/构造调用），CONTAINS（结构性包含），DECLARES（在文件/包/类中声明），
    DIR_INCLUDE（目录包含/引用），EXTENDS（继承），HAS_TYPE（字段/变量/返回等的类型指向），
    IMPLEMENTS（接口实现），RETURNS（方法返回类型），USES（使用/依赖），f2c（Block之间,以及Block与File的包含关系）。

请你综合：① root_info（根模块语义） ② 用户原始查询 ③ 关键词提示 ④ 索引命中样例，
将含糊/口语化的查询扩展为 2~4 个**可执行导向**的检索意图。务必**紧贴用户原始查询**与 `index_hits` 暗示的真实落点，避免凭空臆造。

[项目根模块说明 root_info]
{root_info}

[用户原始查询 user_query]
{user_query}

[关键词（模型可参考扩展/收敛） query_keywords]
{query_keywords}

[基于关键词的索引命中样例（精简） index_hits，这个信息可以帮助你大体上了解本代码库有哪些相关内容，但不仅限于这些内容，不能因为这些内容而改变用户的原意]
{index_hits}

目标：输出一组可以直接映射到图查询的意图，每个意图应指明：大致查询粒度（query_range）、可能相关的节点的full_name，以及**该意图对应的任务类型**（从下列集合中选择其一）：
- 语义搜索与代码定位
- 依赖关系与调用链分析 
- 特定代码节点解释
最后给出针对每个查询问题,为了解决此问题如果需要进一步检索的关键词.此时可以不局限于给出 query_keywords输入,你可以根据问题的需要给出更细化或者更宽泛关键词.
同时给出检索时要重点关注的节点标签（labels）、可能用到的关系集合（relations）.

请严格输出**合法 JSON**（不要夹杂多余文本），结构如下：
{{
  "clarified_queries": [
    {{
      "id": "Q1",
      "query": "用户可能真正想问的清晰问题",
      "why": "基于 root_info / query_keywords / index_hits 的理由（简要）",
      "query_range": smaller / single_file / multi_files,
      "task_type": "语义搜索与代码定位",
      "detail_name" :[],  //当你找到确实存在且很可能与query相关的name时,无论是class还是method等,填写此字段,优先填写full_name,full_name为None则填写name,尤其是在在task_type为"特定代码节点解释"和"依赖关系与调用链分析"时，判断需要解释谁或分析谁，要填写用户明确指出的name或者index_hits中提到的name
      "search_keywords_cn" : [], //为了解决此query可以进一步查询的中文关键词
      "search_keywords_en" : [], //为了解决此query可以进一步查询的英文关键词
      "targets": ["Class","Method","File","Package","Interface","Enum","Record","Annotation","Directory","Block","Field"], 
      "relations": ["ANNOTATES","CALLS","CONTAINS","DECLARES","DIR_INCLUDE","EXTENDS","HAS_TYPE","IMPLEMENTS","RETURNS","USES","f2c"]
    }}
  ],
  "followup_questions": [
    "若仍有歧义，建议向用户追问的 1~3 个具体问题（可选）"
  ],
  "confidence": 0.0
}}

补充要求与约束：
1) **Java 版限定**：`targets` 只能来自上述 Java labels；`relations` 只能来自上述 11 种边。
2) **贴合性优先**：若用户查询未显式或强烈暗示细粒度主题，避免输出过细的意图；优先采用与 `index_hits` 明显相符的落点。
3) **证据对齐**：在 `evidence` 中尽可能引用 `query_keywords` 的子集与 `index_hits` 的代表性命中（名称/简短引用），以降低幻觉。
4) **稳健性**：若 `index_hits` 显示落点集中在某标签（如 Method 或 Package），`targets` 应随之收敛；若 `index_hits` 稀疏或分散，可提供 1~2 个更通用的上位意图（如先定位 Package/Directory，再向下钻）。
5) 必须输出**合法 JSON**，不得出现注释或多余自然语言。
"""
)

QUERY_EXPAND_PROMPT2 = PromptTemplate(
    input_variables=["user_query", "root_info", "query_keywords", "index_hits"],
    template=r"""
你是一个面向“Java 代码知识图谱（Neo4j）”的高级检索意图分析专家。
【重要】本图谱以 **Java** 为主（.java），节点与关系如下，仅能使用其内的取值。

【图谱结构说明（Java 版）】
- 节点（labels）：
  - Block：模块/子系统的抽象汇总,一个Block可能包含多个子Block和子文件。
  - Package：Java 包（如 `com.example.cache`）。
  - File：源文件（`.java`）。
  - Class：类；Interface：接口；Enum：枚举；Record：记录类；Annotation：注解类型。
  - Method：方法；Field：字段。
- 关系：
  - ANNOTATES（注解应用），CALLS（方法/构造调用），CONTAINS（结构性包含），DECLARES（在文件/包/类中声明），
    DIR_INCLUDE（目录包含/引用），EXTENDS（继承），HAS_TYPE（字段/变量/返回等的类型指向），
    IMPLEMENTS（接口实现），RETURNS（方法返回类型），USES（使用/依赖），f2c（Block之间,以及Block与File的包含关系）。

【输入信息】
[项目根模块说明 root_info]
{root_info}

[用户原始查询 user_query]
{user_query}

[关键词（模型可参考扩展/收敛） query_keywords]
{query_keywords}

[基于关键词的索引命中样例（精简） index_hits，用于辅助理解代码库内容，辅助填充 detail_name]
{index_hits}

【任务目标】
请综合上述信息，将用户的原始查询拆解为**四个不同角色视角**的详细问题列表。
针对每个角色，生成 **1~3 个**可执行导向的检索意图（如果该角色与当前问题完全无关，可为空列表，但请尽量挖掘相关性）。

**角色定义与关注点：**
1. **产品经理 (product_manager)**: 侧重 **业务逻辑**。关注功能背后的业务规则、场景意义、流程定义。
2. **程序员 (developer)**: 侧重 **代码实现**。关注函数细节、具体逻辑实现、代码行级逻辑、异常处理。
3. **初学者 (beginner)**: 侧重 **整体框架/入门**。关注代码位置、目录结构、入口点、如何快速上手。
4. **架构师 (architect)**: 侧重 **架构设计**。关注模块交互、设计模式、接口定义、数据流向、技术选型。

【单个意图的字段填写要求（不要删除或修改逻辑）】
对于生成的每一个问题对象，必须包含以下字段：
- **detail_name**: 当你找到确实存在且很可能与query相关的name时,无论是class还是method等,填写此字段。
    - **优先填写 full_name** (如 `com.pkg.ClassName`)。
    - 如果 full_name 为 None 则填写 name。
    - 尤其是在 task_type 为 "特定代码节点解释" 和 "依赖关系与调用链分析" 时，必须判断需要解释谁或分析谁，要填写 **用户明确指出的 name** 或者 **index_hits 中提到的 name**。
- **task_type**: 必须从以下集合中选择其一：
    - "语义搜索与代码定位"
    - "依赖关系与调用链分析"
    - "特定代码节点解释"
- **targets**: 只能来自上述 Java labels (如 Class, Method, Package 等)。
- **relations**: 只能来自上述 11 种关系 (如 CALLS, USES, EXTENDS 等)。

【输出格式】
请严格输出**合法 JSON**（不要夹杂多余文本），结构如下：

{{
  "categories": {{
    "product_manager_questions": [  // 针对产品经理的问题列表
      {{
        "id": "PM_Q1",
        "query": "用户可能真正想问的清晰业务问题",
        "why": "基于 root_info / query_keywords / index_hits 的推导理由",
        "query_range": "smaller" / "single_file" / "multi_files",
        "task_type": "语义搜索与代码定位", 
        "detail_name": [], 
        "search_keywords_cn": [], // 针对此问题的中文检索词
        "search_keywords_en": [], // 针对此问题的英文检索词
        "targets": ["Class", "Method", ...],
        "relations": ["CALLS", "USES", ...]
      }}
    ],
    "developer_questions": [ // 针对了解部分代码的程序员的问题列表
       {{
         "id": "DEV_Q1",
         "query": "关于代码实现的具体问题",
         "why": "...",
         "query_range": "single_file",
         "task_type": "特定代码节点解释",
         "detail_name": ["com.example.SpecificClass"],
         "search_keywords_cn": [],
         "search_keywords_en": [],
         "targets": ["Method", "Field"],
         "relations": ["CALLS", "DECLARES"]
       }}
    ],
    "beginner_questions": [ // 针对初学者的问题列表
       {{ ... }}
    ],
    "architect_questions": [ // 针对架构师的问题列表
       {{ ... }}
    ]
  }},
  "followup_questions": [
    "若仍有歧义，建议向用户追问的 1~3 个具体问题（可选）"
  ],
  "confidence": 0.0
}}

【补充要求与约束】
1. **Java 版限定**：严格遵守前述节点和关系的枚举值。
2. **贴合性优先**：务必紧贴用户原始查询与 index_hits 暗示的真实落点，避免凭空臆造。
3. **稳健性**：若 index_hits 稀疏或分散，可提供更通用的上位意图（如先定位 Package/Directory）。
4. **禁止幻觉**：detail_name 必须基于 index_hits 或用户输入，不可编造。
"""
)
expand_chain = (
    QUERY_EXPAND_PROMPT2
    | _llm
    | StrOutputParser()
)

def expand_user_query(
    user_query: str,
    query_keywords: Optional[Union[Dict[str, Any], list, str]] = None,
    index_hits: Optional[Union[Dict[str, Any], list, str]] = None,
) -> Union[Dict[str, Any], str]:
    """
    读取 root_info，组装 Prompt，上下文交给 expand_chain 执行。
    新增参数：
      - query_keywords: 与用户查询相关的关键词（dict/list/str 均可，内部会转为 JSON 字符串）
      - index_hits: 基于关键词在 Neo4j/全文索引的命中样例（dict/list/str 均可，内部会转为 JSON 字符串）
    返回值优先解析为 JSON(dict)，若解析失败则返回原始字符串。
    """
    root_info = get_root_info()  # 从 Neo4j 取根 Block 的说明（可能为空）

    # 将新增两个输入序列化为字符串，空值提供合理兜底
    query_keywords_str = to_json_str(query_keywords, fallback_empty="[]")
    index_hits_str = to_json_str(index_hits, fallback_empty="{}")

    # 通过 LCEL 定义好的 expand_chain 执行
    output_text: str = expand_chain.invoke({
        "user_query": user_query,
        "root_info": root_info or "(root semantic_explaination is empty)",
        "query_keywords": query_keywords_str,
        "index_hits": index_hits_str,
    }).strip()

    # 若模型外包了 ```json 代码块，做一次清洗
    if output_text.startswith("```"):
        cleaned = output_text.strip("` \n")
        first_brace = cleaned.find("{")
        last_brace = cleaned.rfind("}")
        if first_brace != -1 and last_brace != -1:
            output_text = cleaned[first_brace:last_brace+1]

    # 解析 JSON；失败则回传原文，方便上层处理/日志观测
    try:
        return json.loads(output_text)
    except Exception:
        return output_text