# expand_keyword.py
from __future__ import annotations
from typing import Dict, Any, Union

import json
from langchain.prompts import PromptTemplate
from langchain.schema import StrOutputParser

from utils import get_llm, get_root_info

# ===== LLM 实例（模块级缓存） =====
_llm = get_llm()

# ===== KEYWORD_PROMPT =====

KEYWORD_PROMPT = PromptTemplate(
    input_variables=["user_query", "root_info"],
    template=r"""
你是一名“代码图检索关键词规划器”。当前用户面向一个 Neo4j 代码图数据库进行自然语言检索。
（目标代码库：**Java**，以 `.java` 为主）

请阅读以下【图谱结构说明】与【root_info】，完成以下任务：
1. **关键词抽取**：基于【用户请求】与【root_info】生成中英文关键词（粗粒度+细粒度），并提供同义词。
2. **意图识别（Labels）**：分析用户想要寻找的是哪种类型的代码实体（如：是在找某个类？还是找某个方法？是找整个包？还是找某个模块（Block）？），并对可能的 **节点标签（Labels）** 打分。
3. **关系推测（Relations）**：推测用户查询涉及哪些代码关系（如：调用、继承、包含），并打分。
4. **路径/文件推测**：推测可能相关的 Java 目录或文件名。

【图谱结构说明（Java 版）】
请严格参考以下定义：
- **节点标签 (Labels)**：
  - `Block`：逻辑模块/子系统的抽象汇总（通常对应业务领域或大型组件）。
  - `Package`：Java 包（如 `com.example.cache`）。
  - `File`：源文件（`.java`）。
  - `Class`：类；`Interface`：接口；`Enum`：枚举；`Record`：记录类；`Annotation`：注解定义。
  - `Method`：类或接口中的方法。
  - `Field`：成员变量/字段。
- **关系类型 (Relations)**：
  - `ANNOTATES` (注解应用), `CALLS` (调用), `CONTAINS` (包含), `DECLARES` (声明),
  - `DIR_INCLUDE` (目录包含), `EXTENDS` (继承), `HAS_TYPE` (类型引用),
  - `IMPLEMENTS` (实现), `RETURNS` (返回类型), `USES` (使用/依赖), `f2c` (Block包含File/Block)。

【root_info】
{root_info}

【用户请求】
{user_query}

【评分与输出要求】
1. **贴合度评分**：所有输出项（关键词、Label、Relation、Path）都必须包含 `"score"` (0.0~1.0)，分数越高代表越符合用户意图。
  **必须紧贴用户原始查询**：如果用户的查询没有显式或强烈暗示某个细粒度主题，请**不要**返回该细粒度关键词，宁缺毋滥。
2. **Label 判定逻辑**：
   - 若用户问 "xxx函数" 或 "怎么调用"，则 `Method` 应高分。
   - 若用户问 "xxx类" 或 "xxx策略的定义"，则 `Class`/`Interface` 应高分。
   - 若用户问宏观概念 "xxx模块" 或 "xxx层"，则 `Block`/`Package` 应高分。
   - 若意图模糊，可给出多个相关 Label，但在无明显信号时不要全选。
3. **Relation 判定逻辑**：
   - 若问 "子类" 或 "派生"，则 `EXTENDS`/`IMPLEMENTS` 高分。
   - 若问 "谁用了它"，则 `CALLS`/`USES` 高分。
【产出要求】
1) 只产出**JSON**，不得输出任何解释性文字。
2) 关键词覆盖策略：
   - 以**用户请求**为主，结合 **root_info** 中的术语/子系统词条做扩展（如出现 “包/类/接口/注解/缓存层/索引/并发/持久化”等）。
   - 注意**粒度控制**：粗粒度为领域/子系统/大类；细粒度为机制/算法/策略/关键参数。若无明显需求，细粒度不要输出。
   - 对容易出现多译的术语，**中英两侧各自补充**常见写法与同义词（如“缓存淘汰策略”↔“cache eviction/replacement policy”），并给出相应 `score`。
3) 推测目录与文件名（Java 导向）：
   - 仅在用户请求或 root_info 对应领域存在**较强信号**时给出（如“缓存/策略/仿真”等），并提供 `score`。
   - 目录以项目惯例与包结构呈现（如 `src/main/java/{{package}}/...`），文件以 `.java` 为主；允许为空数组；严禁臆造与语境无关的名称。
4) 能力边界（必须遵守）：
   - 不访问数据库，不返回已确认的实际路径/文件；仅作“可能相关”的名称推测。
   - 不捏造超出用户请求与 root_info 的专有名词；若领域不明显，以更“通用而不失针对性”的术语覆盖。
   - 严格输出可被 `json.loads` 解析的 JSON。
5) JSON 顶层字段与示例结构（示例仅为结构说明，不代表真实输出；注意每项含 `"term"` 与 `"score"`）：
{{
  "coarse": {{
    "cn": [{{"term": "缓存", "score": 0.96}}, {{"term": "索引", "score": 0.62}}],
    "en": [{{"term": "cache", "score": 0.96}}, {{"term": "index", "score": 0.60}}]
  }},
  "fine": {{
    "cn": [{{"term": "缓存淘汰策略", "score": 0.88}}, {{"term": "写回缓存", "score": 0.70}}],
    "en": [{{"term": "cache eviction policy", "score": 0.88}}, {{"term": "write-back cache", "score": 0.69}}]
  }},
  "synonyms": {{
    "cn": {{
      "缓存淘汰策略": [{{"term": "缓存替换策略", "score": 0.85}}, {{"term": "缓存置换策略", "score": 0.82}}]
    }},
    "en": {{
      "cache eviction policy": [{{"term": "cache replacement policy", "score": 0.87}}, {{"term": "eviction strategy", "score": 0.84}}]
    }}
  }},
  "target_labels": [
    {{"label": "Class", "score": 0.95}},
    {{"label": "Interface", "score": 0.80}},
    {{"label": "Method", "score": 0.20}}
  ],
  "target_relations": [
    {{"rel": "EXTENDS", "score": 0.90}},
    {{"rel": "IMPLEMENTS", "score": 0.85}},
    {{"rel": "CALLS", "score": 0.10}}
  ],
  "guessed_paths": {{
    "directories": [{{"term": "src/main/java/com/example/cache/", "score": 0.82}}, {{"term": "src/main/java/com/example/strategy/", "score": 0.76}}, {{"term": "src/test/java/com/example/cache/", "score": 0.55}}],
    "files": [{{"term": "Cache.java", "score": 0.84}}, {{"term": "CacheManager.java", "score": 0.82}}, {{"term": "EvictionStrategy.java", "score": 0.78}}, {{"term": "CacheConfig.java", "score": 0.70}}]
  }},
  "notes": "仅基于用户请求与 root_info 提炼；细粒度条目只在用户有明确或强信号时出现；路径/文件名为 Java 项目常见命名的推测，若缺乏信号可留空。"
}}

"""
)

keyword_chain = (
    KEYWORD_PROMPT
    | _llm
    | StrOutputParser()
)

def expand_user_keyword(user_query: str) -> Union[Dict[str, Any], str]:
    """
    读取 root_info，组装 Prompt，交给 keyword_chain 执行。
    优先解析为 JSON(dict)，失败则返回原始字符串（便于上层日志/回退）。
    """
    root_info = get_root_info() or "(root semantic_explaination is empty)"
    output_text: str = keyword_chain.invoke({
        "user_query": user_query,
        "root_info": root_info
    }).strip()

    # 允许模型把 JSON 外面包了代码块或前后空白——做一次清洗
    if output_text.startswith("```"):
        # 去掉 ```json 包裹
        output_text = output_text.strip("` \n")
        # 可能形如: json\n{...}
        first_brace = output_text.find("{")
        last_brace = output_text.rfind("}")
        if first_brace != -1 and last_brace != -1:
            output_text = output_text[first_brace:last_brace+1]

    try:
        return json.loads(output_text)
    except Exception:
        return output_text
