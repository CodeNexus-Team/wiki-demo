"""
Wiki 交互式修改智能体

使用 Anthropic Claude API 的 tool use 模式，实现 agentic loop：
Claude 根据用户需求自主决定需要哪些数据源，收集信息后提交结构化修改。
"""

import os
import json
import asyncio
import re
import time
import logging
import tempfile
from typing import List, Dict, Any, Optional

# ==================== 日志配置 ====================

LOG_DIR = os.path.join(os.path.dirname(__file__), "logs")
os.makedirs(LOG_DIR, exist_ok=True)

agent_logger = logging.getLogger("agent")
agent_logger.setLevel(logging.DEBUG)
_handler = logging.FileHandler(os.path.join(LOG_DIR, "agent.log"), encoding="utf-8")
_handler.setFormatter(logging.Formatter("%(asctime)s [%(levelname)s] %(message)s"))
agent_logger.addHandler(_handler)
   
# ==================== 配置 ====================

CLAUDE_MODEL = os.environ.get("CLAUDE_MODEL", "sonnet")  # claude CLI 支持: sonnet, opus, haiku
CLAUDE_MAX_TOKENS = int(os.environ.get("CLAUDE_MAX_TOKENS", "4096"))  # 限制输出 token 数加速响应
MAX_TOOL_ROUNDS = int(os.environ.get("MAX_TOOL_ROUNDS", "15"))
SOURCE_ROOT_PATH = os.environ.get("SOURCE_ROOT_PATH", "")

# 追踪本 agent 创建的所有 session_id，用于安全清理
_owned_session_ids: set = set()

# Wiki index 缓存：{abs_wiki_root: (mtime, index_dict)}
_wiki_index_cache: Dict[str, tuple] = {}


def _resolve_wiki_root(wiki_root: str) -> str:
    """把 wiki_root 规范化为绝对路径"""
    if os.path.isabs(wiki_root):
        return wiki_root
    return os.path.join(os.path.dirname(__file__), wiki_root)


def _load_wiki_index(wiki_root: str) -> Optional[dict]:
    """读取 wiki_root/.index/wiki_index.json，按 mtime 做内存缓存"""
    abs_root = _resolve_wiki_root(wiki_root)
    index_path = os.path.join(abs_root, ".index", "wiki_index.json")
    if not os.path.isfile(index_path):
        return None
    try:
        mtime = os.path.getmtime(index_path)
        cached = _wiki_index_cache.get(abs_root)
        if cached and cached[0] == mtime:
            return cached[1]
        with open(index_path, "r", encoding="utf-8") as f:
            index = json.load(f)
        _wiki_index_cache[abs_root] = (mtime, index)
        return index
    except (OSError, json.JSONDecodeError) as e:
        agent_logger.warning(f"加载 wiki_index 失败: {e}")
        return None


def _get_known_wiki_paths(wiki_root: str) -> set:
    """从 wiki_index.json 获取所有已知的 wiki 页面路径（集合）。
    复用 _load_wiki_index 的 mtime 缓存，不存在时返回空集合。
    """
    index = _load_wiki_index(wiki_root)
    if not index or not isinstance(index, dict):
        return set()
    paths = set()
    for p in index.get("pages", []):
        if isinstance(p, dict) and p.get("path"):
            paths.add(p["path"])
    return paths


def _linkify_wiki_paths(text: str, known_paths: set) -> str:
    """
    把回答文本里出现的 wiki 页面路径替换为 markdown 链接：
      xxx/yyy/订单退货服务.json  →  [订单退货服务](wiki://xxx/yyy/订单退货服务.json)

    规则：
    - 只替换 known_paths 里真实存在的 path（避免误伤源码 .java 文件）
    - 跳过已经在 markdown 链接 `[..](..)` 里的路径（幂等）
    - 路径被 backtick 包裹 ``...`` 时，连同 backtick 一起替换为链接
    - 按长度倒序匹配，避免短路径吃掉长路径的子串
    """
    if not text or not known_paths:
        return text

    # 收集已有 markdown 链接的 span，避免重复包装
    linked_spans: List[tuple] = [(m.start(), m.end()) for m in re.finditer(r'\[[^\]]*\]\([^)]*\)', text)]

    # 按长度倒序排序，优先长路径
    sorted_paths = sorted(known_paths, key=len, reverse=True)

    # 收集要替换的 span：(start, end, replacement)
    replacements: List[tuple] = []
    occupied: List[tuple] = []  # 已选中的 span，防止重叠

    def _overlaps(s: int, e: int, spans: List[tuple]) -> bool:
        return any(not (e <= x or s >= y) for x, y in spans)

    for path in sorted_paths:
        display = os.path.splitext(os.path.basename(path))[0]
        link_md = f"[{display}](wiki://{path})"
        escaped = re.escape(path)
        # 两种匹配模式：带 backtick 包裹 / 裸 path
        # 先处理 `path`（连 backtick 一起替换），再处理裸 path
        for pat in (rf'`{escaped}`', escaped):
            for m in re.finditer(pat, text):
                start, end = m.span()
                if _overlaps(start, end, linked_spans):
                    continue
                if _overlaps(start, end, occupied):
                    continue
                replacements.append((start, end, link_md))
                occupied.append((start, end))

    if not replacements:
        return text

    # 从后往前替换，避免位置偏移
    replacements.sort(key=lambda r: r[0], reverse=True)
    out = text
    for start, end, rep in replacements:
        out = out[:start] + rep + out[end:]
    return out


def _build_wiki_overview(index: dict, current_page: str) -> str:
    """
    把 wiki_index 格式化为 prompt 段落。
    当前页用 ★ 标记，其余页面供模型按需通过 wiki-reader MCP 工具跳读。
    """
    pages = index.get("pages", []) if isinstance(index, dict) else []
    if not pages:
        return ""

    current_norm = current_page.lstrip("/")
    lines = []
    for p in pages:
        path = p.get("path", "")
        if not path:
            continue
        summary = (p.get("summary") or "").replace("\n", " ").strip()
        classes = p.get("classes") or []
        marker = "★ " if path == current_norm else "  "
        line = f"{marker}- {path} — {summary}"
        if classes:
            cls_preview = ", ".join(classes[:6])
            if len(classes) > 6:
                cls_preview += f" …(+{len(classes) - 6})"
            line += f" [classes: {cls_preview}]"
        lines.append(line)

    header = (
        "\n## Wiki 总览（全部页面，★ 为当前页）\n"
        "若用户问题涉及当前页以外的内容，**先从下表挑 1~2 个最相关页面**，"
        "然后调用 MCP 工具 `get_page_outline(path)` 查看结构、"
        "`read_wiki_page(path)` 读取内容、"
        "`read_wiki_section(path, section_id)` 精准读某段。\n"
        "path 直接用下表中的相对路径（例如 `门户系统/订单管理.json`），无需拼绝对路径。\n"
    )
    return header + "\n".join(lines)

# ==================== System Prompt ====================

CLARIFICATION_PREFIX = "@@CLARIFY@@"
QA_ANSWER_PREFIX = "@@QA_ANSWER@@"
SUGGEST_EDIT_PREFIX = "@@SUGGEST_EDIT@@"

# ==================== Prompt 段模板 ====================
#
# 设计：把两个大 system prompt 拆成独立段常量，按场景拼装。
#   - 共享段（被两个路径复用）:CLARIFY_BASE / CROSS_PAGE / EDIT_PROTOCOL / CLARIFY_FOR_EDIT
#   - QA 路径专属:QA_IDENTITY / QA_FORMAT_BASIC / SUGGEST_EDIT / EDIT_EXAMPLES
#   - Detailed 路径专属:DETAILED_IDENTITY / INTENT_DETECTION / EDIT_WORKFLOW
#
# 拼装逻辑见本文件底部的 build_qa_system_prompt / build_detailed_system_prompt。
# 纯问答场景下(无修改信号)QA 段只注入前四段,相比原版节省 ~66% 字数。

# ---- 共享段 ----

PROMPT_CLARIFY_BASE = """## 澄清机制
你有一个 `ask_user` 工具可以直接向用户提问。以下情况**必须**调用 `ask_user` 工具澄清,不要猜测用户意图,不要以普通文本形式提问:

- 用户问题过于笼统("讲讲这个"、"介绍一下"、"优化一下"、"处理一下"),不清楚想了解/改动哪个方面
- 用户指令涉及页面多个模块,不确定指的是哪个
- 用户指令存在多种合理解读方式
- 用户指令可以有多种执行方式,你不确定用户想要哪种

调用 `ask_user` 时:
- question: 清晰的问题描述,用内容标题或摘要指代 block,**绝不使用** S12/B34 这种内部 id(用户看不懂)
- options: 提供 3~5 个可选方向,最后一个固定为"其他(请在输入框说明)"
- multi_select: 当选项不互斥、用户可能想同时选多个时设为 true

用户回答后,根据回答继续执行。"""


PROMPT_CROSS_PAGE = """## 跨页查阅
如果需求/问题涉及**当前页以外**的模块(例如当前是"订单管理"而用户提到"登录"),
请先查看 prompt 中的「Wiki 总览」段落,从中挑选 1~2 个最相关的页面,然后使用
 `wiki-reader` MCP 工具按相对路径读取:
- `get_page_outline(path)` — 只返回结构大纲,快速定位
- `read_wiki_page(path)` — 读取精简的 block 树(已去除 neo4j 元数据)
- `read_wiki_section(path, section_id)` — 精准读取某个 block 及其子树
- `list_wiki_pages(prefix)` — 按前缀列出可用页面

path 直接使用总览表中的相对路径(如 `门户系统/订单管理.json`),不要拼绝对路径。
仅在 wiki 无法满足时才去搜源码或查 Neo4j。不要盲目 Grep 所有源码。"""


PROMPT_EDIT_PROTOCOL = """## 修改输出协议
修改指令可包含多个操作,每个操作用 `===` 分隔。每个操作的格式:

```
---
action: replace 或 insert_after 或 delete
target: 目标 block 的 ID
source_ids: 关联的源码 ID,逗号分隔(可选)
---
修改后的 markdown 正文(delete 操作不需要正文)
```

示例(两个操作):
```
---
action: replace
target: S74
source_ids: 1, 5
---
这是修改后的详细描述内容...
===
---
action: insert_after
target: S74
source_ids: 3
---
这是新增的补充段落...
```

格式规则:
- action 三选一: replace(替换目标 block 内容)、insert_after(在目标 block 后插入)、delete(删除目标 block)
- target 必须是页面中已有的 block ID
- markdown 内容使用中文
- 每轮修改建议最多 5 个操作,超过请改用自然语言在回答里描述建议"""


PROMPT_CLARIFY_FOR_EDIT = """## 修改目标澄清(重要)
用户看到的是渲染后的 markdown 内容,**不知道** `S12` / `B34` 这种内部 block id。用户只能用:
- **标题指代**:"把【订单创建流程】那段改一下"
- **主题指代**:"把讲 JWT 的那段补充 refresh token 逻辑"
- **摘要指代**:"把说订单状态有 5 种的那个表格改成 7 种"
- **位置指代**(模糊):"上面那段"、"这段内容"、"刚才提到的"

你的职责是从用户描述**反向推断 target**:读下方「当前页 block 清单」的每一行(含 title、预览、source_ids),通过语义匹配找到唯一 block,把 id 填入 target。

以下情况**必须**调用 `ask_user` 工具澄清,绝不"蒙一个" target:
- 位置指代模糊("上面那段"、"这段")→ 无法确定具体 block
- 多个候选都符合(如页面有两段都讲某主题)
- 完全找不到匹配(用户说的内容不在当前页)

ask_user 的 options 里**用自然语言描述 block**(section 标题或内容摘要),不要使用 `[S12]` 之类的 id。"""


# ---- QA 路径专属段 ----

PROMPT_QA_IDENTITY = """你是代码知识问答助手。用户正在浏览一份基于源码生成的 Wiki 文档,对其中的内容或关联的源码提出问题。

## 核心原则
- 回答必须基于实际源码或 Wiki 文档内容,禁止凭空编造
- 优先使用 Read 工具读取源码文件获取准确信息,再用 Grep 搜索补充
- 仅当需要查询跨模块关系时使用 `query_neo4j`
- 如果无法通过工具获取信息,坦诚说明而非猜测

## 工作流程
1. 理解用户的问题,结合提供的 Wiki 页面内容和结构
2. 如果问题涉及当前页以外的模块,按「跨页查阅」段指引使用 wiki-reader 工具
3. 根据"关联源码路径"使用 Read 工具读取对应源码
4. 如需搜索更多代码,使用 Grep
5. 基于事实给出清晰、准确的回答
6. 源码根目录在 {{SOURCE_ROOT_PATH}}"""


PROMPT_QA_FORMAT_BASIC = """## 输出格式(必须严格遵守)
回答必须以 `@@QA_ANSWER@@` 开头(作为响应的第一行),后接 markdown 正文:

```
@@QA_ANSWER@@
(markdown 格式的回答,可引用源码片段,使用中文)
```

- 简洁明了,直击问题核心
- 适当引用源码片段
- 当提到具体 wiki 页面的相对路径时(例如 `门户系统/主程序/订单退货服务.json`),直接写路径即可,后端会自动识别并生成可点击链接"""


PROMPT_SUGGEST_EDIT = """## 可选的修改建议(严格条件触发)
在回答用户问题后,**仅当满足以下任一条件**时,可以在回答末尾追加一段修改建议,用 `@@SUGGEST_EDIT@@` 作为分隔标记:

1. **用户明确或隐含要求修改** — 问题里出现"改一下/补充/删掉/优化/这里写错了/应该是…"等动作性表达
2. **事实性冲突** — 你通过 Read 工具读取源码后,发现当前 wiki 页面的某个 block 的描述**与实际源码不一致**(例如方法签名变了、字段被删了、描述已过时)

**不满足触发条件时,不得追加修改建议**。特别是:
- ❌ 不得因为"可以写得更详细"、"结构可以更清晰"、"缺少示例"等**主观判断**触发修改
- ❌ 不得仅因为用户问到某个话题就"顺手"改一下
- ❌ 不得无中生有添加 wiki 中没有、源码也未体现的内容
- ❌ 不得在匹配不到 target 时"蒙一个"填上,必须走 `ask_user` 澄清

触发时的完整输出格式:

```
@@QA_ANSWER@@
(先完整回答用户问题)

@@SUGGEST_EDIT@@
---
action: replace | insert_after | delete
target: 目标 block 的 ID(必须是当前页「block 清单」里真实存在的 id)
source_ids: 关联源码 ID,逗号分隔(可选)
---
修改后的 markdown 正文
===
---
action: ...
...
```

修改协议与 target 的规则见「修改输出协议」和「修改目标澄清」两段。"""


PROMPT_EDIT_EXAMPLES = """## 修改建议判断示例

| 用户问题 | 触发 SUGGEST_EDIT? | 理由 |
|---|---|---|
| "订单提交的入口是什么?" | ❌ | 纯提问 |
| "帮我把【订单创建流程】那段改简洁点" | ✅ | 明确要求 + 标题指代,可定位 target |
| "把讲 JWT 的那段补充 refresh token 逻辑" | ✅ | 明确要求 + 主题指代,可定位 target |
| "这段内容改一下" | ❌ → 调 ask_user | 模糊指代,必须澄清 |
| "订单状态那里写错了,源码里是 7 种" | ✅ | 事实性冲突(前提是你读过源码确认) |
| "这个模块的架构能写得再详细点吗?" | ❌ | 主观判断 |
| "登录流程有 JWT 吗?" | ❌ | 纯提问,即使发现 wiki 描述可改善也不触发 |
| "把所有提到 OrderService 的地方都补充调用链" | ❌ → 调 ask_user | 规模过大且目标不唯一,先澄清 |"""


# ---- Detailed 路径专属段 ----

PROMPT_DETAILED_IDENTITY = """你是 Wiki 文档助手。用户选中了一些内容块并提出了需求。

## 核心原则
- 禁止凭空编造内容。所有描述必须基于实际源码或 Neo4j 图谱数据
- 你必须先通过工具查阅相关源码文件或 Neo4j 数据,确认事实后再撰写
- 如果工具不可用或查不到数据,只能基于用户提供的已有 block 内容进行回答或润色改写,不得添加未经验证的技术细节
- source_ids 中填写的 ID 必须来自页面已有的源码引用,或者你通过工具确认存在的文件"""


PROMPT_INTENT_DETECTION = """## 意图判断(最高优先级)
收到用户输入后,先判断意图类型,再决定输出格式:

### 提问类
特征:用户在询问、了解、追问。例如"是什么"、"为什么"、"怎么"、"有哪些"、"解释"、"什么区别"、"如何实现"、"调用关系"等疑问表达,或明显在追问某个事实/原理,而非要求修改内容。

此时输出格式:
```
@@QA_ANSWER@@
(markdown 格式的回答,可引用源码片段,使用中文)
```

### 修改类
特征:用户要求修改、补充、删除、重写、优化内容,或包含"改成"、"加上"、"删掉"、"补充"、"重写"等动作指令。

此时按「修改工作流程」和「修改输出协议」执行,直接输出修改指令,不加 `@@QA_ANSWER@@` 前缀。

### 模糊类
如果无法判断是提问还是修改,调用 `ask_user` 工具澄清。"""


PROMPT_EDIT_WORKFLOW = """## 修改工作流程
1. 阅读用户选中的内容和修改需求
2. 根据"关联源码路径"信息,使用 Read 工具直接读取对应源码文件,获取准确的实现细节
3. 如需进一步搜索相关代码,使用 Grep 在源码目录中搜索关键类名、方法名等
4. 仅当需要查询跨模块调用链、继承关系等实体关系时,才使用 `query_neo4j` 工具查询 Neo4j 知识图谱
5. 基于查到的事实数据输出修改指令
6. 源码根目录在 {{SOURCE_ROOT_PATH}}
7. 只输出修改指令,不要输出解释文字"""


# ==================== Prompt 拼装 ====================

# 用户输入含以下任一词时,QA 路径会注入 SUGGEST_EDIT 相关段
EDIT_SIGNAL_WORDS = (
    # 直接动作词
    "改一下", "改成", "改为", "改得", "改写",
    "修改", "调整", "重写", "完善", "优化", "扩充", "扩展",
    "删掉", "删除", "去掉",
    "补充", "添加", "加上", "加入",
    # 事实性指错
    "写错", "错了", "应该是", "有误",
    "不对", "不正确",
    # 主观评价(弱信号但通常暗示修改)
    "太啰嗦", "太长", "太短", "不够详细", "不够清晰",
)


def _should_allow_suggest_edit(user_query: str) -> bool:
    """判断 user_query 是否含修改信号词,决定是否注入 SUGGEST_EDIT 相关 prompt 段"""
    if not user_query:
        return False
    return any(w in user_query for w in EDIT_SIGNAL_WORDS)


def build_qa_system_prompt(allow_suggest_edit: bool) -> tuple:
    """
    拼装 QA 路径的 system prompt。
    返回 (prompt_text, segment_names) 用于日志。
    """
    parts = [
        ("QA_IDENTITY", PROMPT_QA_IDENTITY),
        ("CLARIFY_BASE", PROMPT_CLARIFY_BASE),
        ("CROSS_PAGE", PROMPT_CROSS_PAGE),
        ("QA_FORMAT_BASIC", PROMPT_QA_FORMAT_BASIC),
    ]
    if allow_suggest_edit:
        parts += [
            ("SUGGEST_EDIT", PROMPT_SUGGEST_EDIT),
            ("EDIT_PROTOCOL", PROMPT_EDIT_PROTOCOL),
            ("CLARIFY_FOR_EDIT", PROMPT_CLARIFY_FOR_EDIT),
            ("EDIT_EXAMPLES", PROMPT_EDIT_EXAMPLES),
        ]
    text = "\n\n".join(p[1] for p in parts)
    names = [p[0] for p in parts]
    return text, names


def build_detailed_system_prompt() -> tuple:
    """
    拼装 detailedQuery 路径的 system prompt。
    detailedQuery 有选中 block,必然要修改协议,全量注入。
    """
    parts = [
        ("DETAILED_IDENTITY", PROMPT_DETAILED_IDENTITY),
        ("INTENT_DETECTION", PROMPT_INTENT_DETECTION),
        ("CLARIFY_BASE", PROMPT_CLARIFY_BASE),
        ("CROSS_PAGE", PROMPT_CROSS_PAGE),
        ("CLARIFY_FOR_EDIT", PROMPT_CLARIFY_FOR_EDIT),
        ("EDIT_WORKFLOW", PROMPT_EDIT_WORKFLOW),
        ("EDIT_PROTOCOL", PROMPT_EDIT_PROTOCOL),
    ]
    text = "\n\n".join(p[1] for p in parts)
    names = [p[0] for p in parts]
    return text, names


# ==================== MCP Server 配置 ====================

NEO4J_MCP_SERVER_PATH = os.path.join(os.path.dirname(__file__), "neo4j_mcp_server.py")
ASK_USER_MCP_SERVER_PATH = os.path.join(os.path.dirname(__file__), "ask_user_mcp_server.py")
WIKI_READER_MCP_SERVER_PATH = os.path.join(os.path.dirname(__file__), "wiki_reader_mcp_server.py")
ASK_USER_COMM_DIR = os.path.join(tempfile.gettempdir(), "ask_user_comm")
os.makedirs(ASK_USER_COMM_DIR, exist_ok=True)

# Claude CLI 允许的工具白名单（显式）
# 内置工具：Read/Grep/Glob 用于读源码，禁用 Edit/Write/Bash 防止模型绕过修改协议
# MCP 工具：neo4j/ask_user/wiki-reader 三个领域封装
ALLOWED_TOOLS = ",".join([
    "Read",
    "Grep",
    "Glob",
    "mcp__neo4j-knowledge-graph__query_neo4j",
    "mcp__ask-user__ask_user",
    "mcp__wiki-reader__read_wiki_page",
    "mcp__wiki-reader__get_page_outline",
    "mcp__wiki-reader__read_wiki_section",
    "mcp__wiki-reader__list_wiki_pages",
])


def _build_mcp_config(wiki_root: Optional[str] = None) -> str:
    """生成临时 MCP 配置文件，返回文件路径。

    Args:
        wiki_root: 可选，wiki 目录绝对路径。若提供则注册 wiki-reader MCP server。
    """
    servers = {
        "neo4j-knowledge-graph": {
            "command": "python",
            "args": [NEO4J_MCP_SERVER_PATH]
        },
        "ask-user": {
            "command": "python",
            "args": [ASK_USER_MCP_SERVER_PATH],
            "env": {
                "ASK_USER_COMM_DIR": ASK_USER_COMM_DIR
            }
        }
    }
    if wiki_root:
        abs_wiki_root = _resolve_wiki_root(wiki_root)
        servers["wiki-reader"] = {
            "command": "python",
            "args": [WIKI_READER_MCP_SERVER_PATH],
            "env": {
                "WIKI_ROOT_PATH": abs_wiki_root
            }
        }

    config = {"mcpServers": servers}
    tmp = tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False, prefix='mcp_config_')
    json.dump(config, tmp, ensure_ascii=False)
    tmp.close()
    agent_logger.info(f"MCP 配置文件: {tmp.name} (wiki_root={'yes' if wiki_root else 'no'})")
    return tmp.name


# ==================== 辅助函数 ====================


def find_blocks_by_ids(blocks: list, target_ids: set) -> list:
    """递归查找指定 ID 的 blocks"""
    found = []
    for block in blocks:
        if block.get("id") in target_ids:
            found.append(block)
        children = block.get("content")
        if isinstance(children, list):
            found.extend(find_blocks_by_ids(children, target_ids))
    return found


def find_blocks_with_ancestors(blocks: list, target_ids: set, ancestors: Optional[list] = None) -> List[dict]:
    """递归查找指定 ID 的 blocks，同时收集祖先链上的 neo4j_id 信息。

    返回列表，每项为 {"block": block, "ancestor_neo4j": {合并后的 neo4j 信息}}
    """
    if ancestors is None:
        ancestors = []
    found = []
    for block in blocks:
        # 构建当前祖先链（如果当前 block 有 neo4j_id 就加入）
        current_ancestors = ancestors[:]
        neo4j_id = block.get("neo4j_id")
        if neo4j_id and isinstance(neo4j_id, dict) and len(neo4j_id) > 0:
            current_ancestors.append(block)

        if block.get("id") in target_ids:
            # 合并所有祖先的 neo4j 信息
            merged_neo4j = {}
            for ancestor in current_ancestors:
                merged_neo4j.update(extract_neo4j_info(ancestor))
            # 也提取 block 自身的
            merged_neo4j.update(extract_neo4j_info(block))
            found.append({"block": block, "ancestor_neo4j": merged_neo4j})

        children = block.get("content")
        if isinstance(children, list):
            found.extend(find_blocks_with_ancestors(children, target_ids, current_ancestors))
    return found


def extract_markdown(block: dict) -> str:
    """从 block 中提取 markdown 文本"""
    if block.get("type") == "text":
        content = block.get("content", {})
        if isinstance(content, dict):
            return content.get("markdown", "")
    elif block.get("type") == "section":
        parts = [block.get("title", "")]
        children = block.get("content", [])
        if isinstance(children, list):
            for child in children:
                parts.append(extract_markdown(child))
        return "\n\n".join(p for p in parts if p)
    return ""


def extract_neo4j_info(block: dict) -> dict:
    """从 block 中递归提取 neo4j_id 和 neo4j_source"""
    result = {}
    neo4j_id = block.get("neo4j_id")
    neo4j_source = block.get("neo4j_source")
    if neo4j_id and isinstance(neo4j_id, dict):
        for key, nid in neo4j_id.items():
            src = neo4j_source.get(key, "") if isinstance(neo4j_source, dict) else ""
            result[key] = {"neo4j_id": nid, "source": src}
    children = block.get("content")
    if isinstance(children, list):
        for child in children:
            if isinstance(child, dict):
                result.update(extract_neo4j_info(child))
    return result


def extract_source_ids(block: dict) -> list:
    """从 block 中递归提取所有 source_id"""
    ids = []
    if isinstance(block.get("source_id"), list):
        ids.extend(block["source_id"])
    children = block.get("content")
    if isinstance(children, list):
        for child in children:
            ids.extend(extract_source_ids(child))
    return ids


def split_markdown_segments(markdown: str) -> list:
    """
    将 markdown 文本按围栏代码块拆分为多个片段。
    返回列表，每项为 {"type": "text", "content": "..."} 或 {"type": "code", "lang": "java", "content": "..."}
    如果没有围栏代码块，返回单个 text 片段。
    """
    segments = []
    # 匹配 ```lang\n...\n```
    pattern = re.compile(r'```(\w*)\n(.*?)\n```', re.DOTALL)

    last_end = 0
    for match in pattern.finditer(markdown):
        # 代码块前的文本
        before = markdown[last_end:match.start()].strip()
        if before:
            segments.append({"type": "text", "content": before})
        # 代码块本身
        lang = match.group(1) or ""
        code = match.group(2)
        segments.append({"type": "code", "lang": lang, "content": code})
        last_end = match.end()

    # 最后一段文本
    after = markdown[last_end:].strip()
    if after:
        segments.append({"type": "text", "content": after})

    # 如果没有匹配到任何代码块，返回原文作为单个 text
    if not segments:
        segments.append({"type": "text", "content": markdown})

    return segments


def _parse_edit_operations(raw_text: str) -> dict:
    """
    解析 ---/=== 修改指令文本，返回 PageDiffResponse 字段。
    抽离自旧版 parse_agent_output，供 detailedQuery / qaQuery 两种路径复用。
    """
    insert_blocks = []
    delete_blocks = []
    replace_blocks = []
    insert_sources = []
    new_block_counter = 0

    # 按 === 分割多个操作
    operations = re.split(r'\n===\n', raw_text.strip())

    for op_text in operations:
        op_text = op_text.strip()
        if not op_text:
            continue

        # 解析 --- header ---
        header_match = re.search(r'---\s*\n(.*?)\n---', op_text, re.DOTALL)
        if not header_match:
            print(f"[Agent] 跳过无法解析的操作: {op_text[:100]}")
            continue

        header_text = header_match.group(1)
        raw_body = op_text[header_match.end():].strip()

        # 解析 header 字段
        action = ""
        target = ""
        source_ids = []

        for line in header_text.strip().split("\n"):
            line = line.strip()
            if line.startswith("action:"):
                action = line.split(":", 1)[1].strip()
            elif line.startswith("target:"):
                target = line.split(":", 1)[1].strip()
            elif line.startswith("source_ids:"):
                raw_ids = line.split(":", 1)[1].strip()
                if raw_ids:
                    source_ids = [s.strip() for s in raw_ids.split(",") if s.strip()]

        if not action or not target:
            print(f"[Agent] 操作缺少 action 或 target: {header_text}")
            continue

        print(f"[Agent] 操作: action={action}, target={target}, source_ids={source_ids}")

        # 将 raw_body 按围栏代码块拆分为多个片段
        segments = split_markdown_segments(raw_body)

        if action == "delete":
            delete_blocks.append(target)

        elif action == "replace":
            # 第一个片段原地替换目标 block
            first_seg = segments[0] if segments else {"type": "text", "content": raw_body}
            replace_blocks.append({
                "target": target,
                "new_content": {"markdown": first_seg["content"]} if first_seg["type"] == "text"
                               else {"markdown": first_seg["content"]},
                "source_ids": source_ids,
            })
            # 后续片段作为 insert_after 追加
            prev_id = target
            for seg in segments[1:]:
                new_block_counter += 1
                block_id = f"NEW_{new_block_counter}"
                if seg["type"] == "code":
                    new_block = {
                        "type": "text",
                        "id": block_id,
                        "content": {"markdown": f"```{seg.get('lang', '')}\n{seg['content']}\n```"},
                        "source_id": [],
                    }
                else:
                    new_block = {
                        "type": "text",
                        "id": block_id,
                        "content": {"markdown": seg["content"]},
                        "source_id": [],
                    }
                insert_blocks.append({
                    "after_block": prev_id,
                    "block": new_block,
                })
                prev_id = block_id

        elif action == "insert_after":
            prev_id = target
            for seg in segments:
                new_block_counter += 1
                block_id = f"NEW_{new_block_counter}"
                if seg["type"] == "code":
                    new_block = {
                        "type": "text",
                        "id": block_id,
                        "content": {"markdown": f"```{seg.get('lang', '')}\n{seg['content']}\n```"},
                        "source_id": source_ids if seg == segments[0] else [],
                    }
                else:
                    new_block = {
                        "type": "text",
                        "id": block_id,
                        "content": {"markdown": seg["content"]},
                        "source_id": source_ids if seg == segments[0] else [],
                    }
                insert_blocks.append({
                    "after_block": prev_id,
                    "block": new_block,
                })
                prev_id = block_id

    return {
        "insert_blocks": insert_blocks,
        "delete_blocks": delete_blocks,
        "replace_blocks": replace_blocks,
        "insert_sources": insert_sources,
        "delete_sources": [],
    }


def _empty_edit_result() -> dict:
    """用于"无修改"的占位返回"""
    return {
        "insert_blocks": [],
        "delete_blocks": [],
        "replace_blocks": [],
        "insert_sources": [],
        "delete_sources": [],
    }


def parse_agent_output(raw_text: str) -> dict:
    """
    解析模型输出：

    1. 首字符若为 @@QA_ANSWER@@ → QA 路径：
       - 若同时包含 @@SUGGEST_EDIT@@ → 切分两段，返回 {"qa_answer": ..., 修改字段...}
       - 否则只返回 {"qa_answer": ...}

    2. 否则 → 修改路径（SYSTEM_PROMPT 的修改协议），走 _parse_edit_operations
    """
    text = raw_text.strip()

    # -------- QA 路径（含可选的 SUGGEST_EDIT）--------
    if text.startswith(QA_ANSWER_PREFIX):
        body = text[len(QA_ANSWER_PREFIX):]
        if SUGGEST_EDIT_PREFIX in body:
            qa_part, _, edit_part = body.partition(SUGGEST_EDIT_PREFIX)
            edit_result = _parse_edit_operations(edit_part.strip())
            return {"qa_answer": qa_part.strip(), **edit_result}
        return {"qa_answer": body.strip(), **_empty_edit_result()}

    # -------- 纯修改路径（detailedQuery 场景）--------
    return _parse_edit_operations(text)


def collect_all_block_ids(blocks: list) -> set:
    """递归收集所有 block 的 id（含 section），用于 target 合法性校验"""
    ids: set = set()
    for block in blocks:
        if not isinstance(block, dict):
            continue
        bid = block.get("id")
        if bid:
            ids.add(bid)
        children = block.get("content")
        if isinstance(children, list):
            ids |= collect_all_block_ids(children)
    return ids


def validate_edit_targets(result: dict, valid_ids: set) -> tuple:
    """
    过滤掉 target 不在 valid_ids 里的修改操作。
    返回 (过滤后 result, 丢弃的操作数)。
    """
    discarded = 0

    def _keep_target(target: str) -> bool:
        nonlocal discarded
        if target in valid_ids:
            return True
        discarded += 1
        agent_logger.warning(f"丢弃非法 target 修改操作: target={target} 不在当前页 block id 集合中")
        return False

    new_replace = [op for op in result.get("replace_blocks", []) if _keep_target(op.get("target", ""))]
    new_delete = [tid for tid in result.get("delete_blocks", []) if _keep_target(tid)]
    # insert_after 的 after_block 也可能是 target，但新建 block 的 NEW_N 是合法的
    new_insert = [
        op for op in result.get("insert_blocks", [])
        if op.get("after_block", "").startswith("NEW_") or _keep_target(op.get("after_block", ""))
    ]

    filtered = {
        **result,
        "replace_blocks": new_replace,
        "delete_blocks": new_delete,
        "insert_blocks": new_insert,
    }
    return filtered, discarded


def has_any_edit(result: dict) -> bool:
    """判断 result 是否包含至少一个真实的修改操作"""
    return bool(
        result.get("insert_blocks")
        or result.get("delete_blocks")
        or result.get("replace_blocks")
    )


def build_block_inventory(blocks: list, depth: int = 0, lines: Optional[list] = None) -> list:
    """
    生成 qa_query 用的"全页 block 清单"：每个 block 一行，含 id + type + 前 80 字预览 + source_ids。
    供纯问答模式下模型自主判断 target 使用。
    """
    if lines is None:
        lines = []
    for block in blocks:
        if not isinstance(block, dict):
            continue
        indent = "  " * depth
        bid = block.get("id", "?")
        btype = block.get("type", "")
        sids = block.get("source_id") or []
        sids_str = f", sources={sids}" if sids else ""

        if btype == "section":
            title = (block.get("title") or "").replace("\n", " ").strip()
            lines.append(f"{indent}- [{bid}] section: {title[:80]}{sids_str}")
            children = block.get("content")
            if isinstance(children, list):
                build_block_inventory(children, depth + 1, lines)
        else:
            content = block.get("content")
            md = content.get("markdown", "") if isinstance(content, dict) else ""
            preview = md[:80].replace("\n", " ")
            if len(md) > 80:
                preview += "..."
            lines.append(f"{indent}- [{bid}] {btype}: {preview}{sids_str}")
    return lines


def build_page_outline(blocks: list, depth: int = 0) -> str:
    """生成页面结构概览（只包含 ID 和标题）"""
    lines = []
    for block in blocks:
        indent = "  " * depth
        if block.get("type") == "section":
            lines.append(f"{indent}- [{block.get('id')}] {block.get('title', '(无标题)')}")
            children = block.get("content")
            if isinstance(children, list):
                lines.append(build_page_outline(children, depth + 1))
        else:
            block_id = block.get("id", "?")
            # text 块只显示前 50 个字符
            md = ""
            content = block.get("content")
            if isinstance(content, dict):
                md = content.get("markdown", "")
            preview = md[:50].replace("\n", " ") + ("..." if len(md) > 50 else "")
            lines.append(f"{indent}- [{block_id}] text: {preview}")
    return "\n".join(lines)


# ==================== 流式 CLI 执行 ====================


async def _run_claude_streaming(
    cli_cmd: List[str],
    cwd: Optional[str],
    on_progress: Optional[callable] = None,
    on_clarify: Optional[callable] = None,
) -> tuple:
    """
    使用 asyncio subprocess 流式执行 Claude CLI，实时解析 stream-json 事件。

    Returns:
        (agent_text, session_id): 最终结果文本和会话 ID
    """
    proc = await asyncio.create_subprocess_exec(
        *cli_cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        cwd=cwd,
    )

    session_id = None
    agent_text = ""

    try:
        async for raw_line in proc.stdout:
            line = raw_line.decode('utf-8').strip()
            if not line:
                continue
            try:
                event = json.loads(line)
            except json.JSONDecodeError:
                continue

            event_type = event.get("type", "")
            event_subtype = event.get("subtype", "")
            message = event.get("message", {})

            # system init — 捕获 session_id
            if event_type == "system" and event_subtype == "init":
                session_id = event.get("session_id")
                if session_id:
                    _owned_session_ids.add(session_id)
                model = event.get("model", "unknown")
                tools = event.get("tools", [])
                tool_names = [t.get("name", "") if isinstance(t, dict) else str(t) for t in tools] if isinstance(tools, list) else []
                agent_logger.info(f"会话初始化: model={model}, session_id={session_id}, 可用工具={tool_names}")

            # assistant 事件 — 工具调用和文本
            elif event_type == "assistant" and isinstance(message, dict):
                for block in message.get("content", []):
                    if not isinstance(block, dict):
                        continue
                    block_type = block.get("type", "")
                    if block_type == "tool_use":
                        tool_name = block.get("name", "unknown")
                        tool_input = block.get("input", {})
                        agent_logger.info(f"工具调用: {tool_name} | 输入: {json.dumps(tool_input, ensure_ascii=False)[:500]}")

                        # 拦截 ask_user 工具调用：读取问题文件 → 通知前端 → 等待回答 → 写回答文件
                        if "ask_user" in tool_name and on_clarify:
                            question_file = os.path.join(ASK_USER_COMM_DIR, "pending.question.json")
                            # 等待 MCP 工具写入问题文件
                            for _ in range(100):
                                if os.path.exists(question_file):
                                    break
                                await asyncio.sleep(0.1)
                            if os.path.exists(question_file):
                                with open(question_file, 'r', encoding='utf-8') as qf:
                                    q_data = json.load(qf)
                                clarify_data = {
                                    "question": q_data.get("question", ""),
                                    "options": q_data.get("options", []),
                                    "multi_select": True,
                                }
                                agent_logger.info(f"ask_user 澄清: {clarify_data}")
                                if on_progress:
                                    on_progress(f"🤔 AI 提问: {clarify_data['question']}")
                                # 异步等待用户回答
                                answer = await on_clarify(clarify_data)
                                agent_logger.info(f"用户回答: {answer}")
                                # 写回答文件，MCP 工具会读取并返回 tool_result
                                answer_file = os.path.join(ASK_USER_COMM_DIR, "pending.answer.json")
                                with open(answer_file, 'w', encoding='utf-8') as af:
                                    json.dump({"answer": answer}, af, ensure_ascii=False)

                        elif on_progress:
                            if tool_name == "Read":
                                fp = tool_input.get("file_path", "")
                                short = fp.split("/")[-1] if fp else "文件"
                                on_progress(f"正在读取源码: {short}")
                            elif tool_name == "Grep":
                                on_progress(f"正在搜索代码: {tool_input.get('pattern', '')[:40]}")
                            elif "neo4j" in tool_name.lower():
                                on_progress("正在查询知识图谱...")
                            elif "wiki-reader" in tool_name or "wiki_reader" in tool_name:
                                wiki_path = tool_input.get("path", "")
                                short = wiki_path.split("/")[-1] if wiki_path else "页面"
                                if "outline" in tool_name:
                                    on_progress(f"正在查看 wiki 大纲: {short}")
                                elif "section" in tool_name:
                                    sid = tool_input.get("section_id", "")
                                    on_progress(f"正在读取 wiki 片段: {short}#{sid}")
                                elif "list" in tool_name:
                                    on_progress("正在列出 wiki 页面...")
                                else:
                                    on_progress(f"正在查阅 wiki 页面: {short}")
                            else:
                                on_progress(f"正在使用工具: {tool_name}")
                    elif block_type == "text":
                        text = block.get("text", "")
                        if text.strip():
                            agent_logger.debug(f"模型文本: {text[:300]}")

            # user 事件 — 工具结果（仅日志）
            elif event_type == "user":
                if "tool_use_result" in event:
                    tool_result = event["tool_use_result"]
                    agent_logger.debug(f"工具结果: {str(tool_result)[:500]}")

            # 速率限制
            elif event_type == "rate_limit_event":
                agent_logger.warning(f"速率限制: {json.dumps(event.get('rate_limit_info', {}), ensure_ascii=False)[:300]}")

            # 最终结果
            elif event_type == "result":
                agent_text = str(event.get("result", ""))
                cost = event.get("cost_usd")
                duration_ms = event.get("duration_ms")
                if cost is not None:
                    agent_logger.info(f"API 费用: ${cost:.4f}")
                if duration_ms is not None:
                    agent_logger.info(f"API 内部耗时: {duration_ms}ms")

        await proc.wait()

    except (Exception, asyncio.CancelledError):
        # 父进程异常或被取消时，确保子进程不会变成孤儿空烧 token
        if proc.returncode is None:
            agent_logger.warning(f"正在终止 Claude CLI 子进程 (pid={proc.pid})")
            proc.terminate()
            try:
                await asyncio.wait_for(proc.wait(), timeout=5)
            except asyncio.TimeoutError:
                proc.kill()
                await proc.wait()
            agent_logger.info(f"子进程已终止 (pid={proc.pid})")
        raise

    if proc.returncode != 0:
        stderr_bytes = await proc.stderr.read()
        stderr = stderr_bytes.decode('utf-8')
        agent_logger.error(f"Claude CLI 失败 (rc={proc.returncode}): {stderr}")
        raise RuntimeError(f"claude CLI 调用失败: {stderr}")

    return agent_text, session_id


# ==================== 核心 agentic loop ====================


async def run_detailed_query(
    page_path: str,
    block_ids: List[str],
    user_query: str,
    wiki_root: str,
    on_progress: Optional[callable] = None,
    on_clarify: Optional[callable] = None,
    resume_session_id: Optional[str] = None,
) -> dict:
    """
    使用 Claude agentic loop 处理用户的详细查询请求。

    Args:
        on_progress: 可选回调，接收进度消息字符串，用于 SSE 推送。
        on_clarify:  可选 async 回调，接收澄清问题字符串，返回用户回答。
                     若为 None 且需要澄清，返回 clarification_needed 结果。
        resume_session_id: 恢复之前会话的 session_id（用于澄清后继续）。

    Returns:
        dict: PageDiffResponse / CreatePageResponse / clarification_needed 结果
    """
    def _progress(msg: str):
        if on_progress:
            on_progress(msg)

    async def _handle_clarification(agent_text: str, session_id: str) -> dict | None:
        """检测并处理澄清请求。返回递归调用结果或 clarification_needed dict，无澄清时返回 None。"""
        if not agent_text.strip().startswith(CLARIFICATION_PREFIX):
            return None

        raw_clarify = agent_text.strip()[len(CLARIFICATION_PREFIX):].strip()
        lines = raw_clarify.split("\n")
        question = lines[0].strip() if lines else raw_clarify
        options = [line.lstrip("- ").strip() for line in lines[1:] if line.strip().startswith("- ")]
        agent_logger.info(f"需要澄清: question={question}, options={options}, session_id={session_id}")

        clarify_data = {"question": question, "options": options}

        if on_clarify:
            answer = await on_clarify(clarify_data)
            return await run_detailed_query(
                page_path, block_ids, answer, wiki_root,
                on_progress=on_progress,
                on_clarify=on_clarify,
                resume_session_id=session_id,
            )
        else:
            return {
                "clarification_needed": True,
                "question": question,
                "options": options,
                "session_id": session_id,
            }

    t_start = time.time()
    agent_logger.info("=" * 60)

    # ---- 恢复模式：用户回答了澄清问题，继续同一会话 ----
    if resume_session_id:
        agent_logger.info(f"恢复会话: session_id={resume_session_id}, answer={user_query[:200]}")
        _progress("用户已回答，继续分析...")

        cli_cmd = [
            "claude", "--resume", resume_session_id,
            "-p", user_query,
            "--output-format", "stream-json",
            "--verbose",
            "--mcp-config", _build_mcp_config(wiki_root),
            "--allowedTools", ALLOWED_TOOLS,
        ]

        agent_text, _ = await _run_claude_streaming(
            cli_cmd, SOURCE_ROOT_PATH or None, on_progress, on_clarify
        )

        # 恢复后仍然可能再次澄清（复用统一处理逻辑，兼容旧会话仍用 @@CLARIFY@@ 的情况）
        clarify_result = await _handle_clarification(agent_text, resume_session_id)
        if clarify_result is not None:
            return clarify_result

        _progress("AI 分析完成，正在解析结果...")
        result = parse_agent_output(agent_text)
        # 对 qa_answer 文本做 wiki 路径链接化
        if "qa_answer" in result and result["qa_answer"]:
            result["qa_answer"] = _linkify_wiki_paths(
                result["qa_answer"], _get_known_wiki_paths(wiki_root)
            )
        result["session_id"] = resume_session_id  # 保持同一会话链
        t_end = time.time()
        agent_logger.info(f"恢复完成: 总耗时={t_end - t_start:.2f}s")
        agent_logger.info("=" * 60)
        return result

    # ---- 正常模式 ----
    agent_logger.info(f"新请求: page_path={page_path}, block_ids={block_ids}, user_query={user_query}")

    # 1. 加载当前页面
    _progress("正在加载页面数据...")
    page_path_clean = page_path.lstrip("/")
    if os.path.isabs(wiki_root):
        json_path = os.path.join(wiki_root, page_path_clean)
    else:
        json_path = os.path.join(os.path.dirname(__file__), wiki_root, page_path_clean)

    print(f"[Agent] wiki_root={wiki_root}, page_path={page_path}, json_path={json_path}")

    if not os.path.isfile(json_path):
        raise FileNotFoundError(f"Wiki 页面文件不存在: {json_path}")

    with open(json_path, 'r', encoding='utf-8') as f:
        page_data = json.load(f)

    page_content = page_data.get("markdown_content", [])

    # 2. 提取选中的 blocks
    _progress(f"正在分析 {len(block_ids)} 个选中的内容块...")
    selected_results = find_blocks_with_ancestors(page_content, set(block_ids))

    # 3. 构建页面结构概览
    outline = build_page_outline(page_content)

    # 4. 提取选中 blocks 的 markdown、source_id 和 neo4j 信息（含祖先）
    selected_parts = []
    all_neo4j_info = {}
    for result in selected_results:
        block = result["block"]
        bid = block.get("id", "?")
        md = extract_markdown(block)
        sids = extract_source_ids(block)
        all_neo4j_info.update(result["ancestor_neo4j"])
        selected_parts.append(f"[{bid}] (source_ids: {', '.join(sids) if sids else '无'})\n{md}")
    selected_text = "\n\n---\n\n".join(selected_parts)

    # 5. 构建关联源码上下文
    source_context = ""
    if all_neo4j_info:
        source_lines = []
        for key, info in all_neo4j_info.items():
            src = info["source"]
            nid = info["neo4j_id"]
            if src:
                source_lines.append(f"- [{key}]: 源码路径={src} (neo4j_id={nid})")
        if source_lines:
            source_context = "\n## 关联源码路径\n请优先使用 Read 工具读取以下路径下的源码，作为修改内容的事实依据：\n" + "\n".join(source_lines)
            source_context += f"\n\n源码根目录: {SOURCE_ROOT_PATH or '(未配置)'}"
            source_context += "\n如需查询跨模块关系，可用 `query_neo4j`: `MATCH (n)-[r]-(m) WHERE id(n) = <neo4j_id> RETURN type(r), m.name`"

    # 6. 构建精简 prompt（拼装 detailed 路径段集合）
    system_prompt_raw, segment_names = build_detailed_system_prompt()
    system_prompt = system_prompt_raw.replace("{{SOURCE_ROOT_PATH}}", SOURCE_ROOT_PATH or "(未配置)")
    agent_logger.info(f"[Detailed] prompt 段: {'+'.join(segment_names)}, system_prompt 字符={len(system_prompt)}")

    wiki_index = _load_wiki_index(wiki_root)
    wiki_overview = _build_wiki_overview(wiki_index, page_path) if wiki_index else ""

    prompt = f"""{system_prompt}
{wiki_overview}

## 当前页面结构概览
{outline}

## 用户选中的内容
{selected_text}
{source_context}

## 用户需求
{user_query}"""

    t_prompt_ready = time.time()
    agent_logger.info(f"Prompt 构建完成: 长度={len(prompt)}, 耗时={t_prompt_ready - t_start:.2f}s")
    agent_logger.debug(f"Prompt 完整内容:\n{prompt}")
    _progress("正在调用 AI 模型进行分析...")

    # 7. 流式执行 Claude CLI
    cli_cmd = [
        "claude", "-p", prompt,
        "--model", CLAUDE_MODEL,
        "--output-format", "stream-json",
        "--verbose",
        "--mcp-config", _build_mcp_config(wiki_root),
        "--allowedTools", ALLOWED_TOOLS,
    ]

    agent_text, session_id = await _run_claude_streaming(
        cli_cmd, SOURCE_ROOT_PATH or None, on_progress, on_clarify
    )

    cli_duration = time.time() - t_prompt_ready
    agent_logger.info(f"模型输出长度: {len(agent_text)}")
    agent_logger.debug(f"模型输出内容:\n{agent_text}")

    # 8. 检测澄清请求（兼容旧的 @@CLARIFY@@ 文本前缀，新会话走 ask_user 工具不会到这里）
    clarify_result = await _handle_clarification(agent_text, session_id)
    if clarify_result is not None:
        return clarify_result

    # 9. 解析模型输出 → PageDiffResponse 或 QA 回答
    _progress("AI 分析完成，正在解析结果...")
    result = parse_agent_output(agent_text)
    # 对 qa_answer 文本做 wiki 路径链接化
    if "qa_answer" in result and result["qa_answer"]:
        result["qa_answer"] = _linkify_wiki_paths(
            result["qa_answer"], _get_known_wiki_paths(wiki_root)
        )
    result["session_id"] = session_id  # 供后续追问 --resume

    t_end = time.time()
    total_duration = t_end - t_start
    if "qa_answer" in result:
        agent_logger.info(f"[QA] 模型判定为提问，回答长度={len(result['qa_answer'])}, "
                          f"CLI耗时={cli_duration:.2f}s, 总耗时={total_duration:.2f}s")
    else:
        agent_logger.info(f"完成: 插入={len(result['insert_blocks'])}, 删除={len(result['delete_blocks'])}, "
                          f"CLI耗时={cli_duration:.2f}s, 总耗时={total_duration:.2f}s")
    agent_logger.info("=" * 60)
    return result


def _qa_build_return(
    parsed: dict,
    raw_agent_text: str,
    session_id: Optional[str],
    known_wiki_paths: Optional[set] = None,
) -> dict:
    """
    统一 QA 路径的返回结构。兼容两种情况：
    1. 模型正确输出 `@@QA_ANSWER@@` 前缀 → parsed 含 qa_answer
    2. 模型忘了前缀或是旧 session → 退化为把 raw 文本当回答

    最终返回保持和 run_detailed_query 对齐的 schema：
      - answer: str            主回答（给前端展示）
      - qa_answer: str         同 answer（和 SYSTEM_PROMPT 路径保持字段兼容）
      - insert_blocks / delete_blocks / replace_blocks / insert_sources / delete_sources
      - session_id: str | None

    如果提供了 known_wiki_paths，会对 answer 做 linkify，把裸 wiki 路径替换为 markdown 链接。
    """
    if "qa_answer" in parsed:
        answer_text = parsed["qa_answer"]
    else:
        # 模型没有按协议输出前缀（可能是旧 session resume）。降级：整段当回答，不当修改指令。
        # 注意 parsed 里可能已经解析出 insert/delete/replace，但 target 校验会过滤掉非法的。
        answer_text = raw_agent_text.strip()

    # 对答案做 wiki 路径硬编码链接化
    if known_wiki_paths:
        answer_text = _linkify_wiki_paths(answer_text, known_wiki_paths)

    return {
        "answer": answer_text,
        "qa_answer": answer_text,
        "insert_blocks": parsed.get("insert_blocks", []),
        "delete_blocks": parsed.get("delete_blocks", []),
        "replace_blocks": parsed.get("replace_blocks", []),
        "insert_sources": parsed.get("insert_sources", []),
        "delete_sources": parsed.get("delete_sources", []),
        "session_id": session_id,
    }


async def run_qa_query(
    page_path: str,
    user_query: str,
    wiki_root: str,
    on_progress: Optional[callable] = None,
    on_clarify: Optional[callable] = None,
    resume_session_id: Optional[str] = None,
) -> dict:
    """
    Wiki & 源码自由问答智能体。

    Args:
        page_path: 当前 Wiki 页面路径
        user_query: 用户问题
        wiki_root: Wiki 文件根目录
        on_progress: 可选进度回调
        on_clarify: 可选 async 回调，接收澄清问题，返回用户回答
        resume_session_id: 恢复之前会话的 session_id（追问时使用）

    Returns:
        dict: {"answer": str, "session_id": str | None}
    """
    def _progress(msg: str):
        if on_progress:
            on_progress(msg)

    t_start = time.time()
    agent_logger.info("=" * 60)

    # ---- 恢复模式：基于上一次 QA 会话继续追问 ----
    if resume_session_id:
        agent_logger.info(f"[QA] 恢复会话: session_id={resume_session_id}, query={user_query[:200]}")
        _progress("正在基于上次对话继续追问...")

        cli_cmd = [
            "claude", "--resume", resume_session_id,
            "-p", user_query,
            "--output-format", "stream-json",
            "--verbose",
            "--mcp-config", _build_mcp_config(wiki_root),
            "--allowedTools", ALLOWED_TOOLS,
        ]

        agent_text, _ = await _run_claude_streaming(
            cli_cmd, SOURCE_ROOT_PATH or None, on_progress, on_clarify
        )

        # 解析（可能含 QA + 可选 SUGGEST_EDIT）
        parsed = parse_agent_output(agent_text)

        # target 校验（需要重新加载当前页面收集 id）
        if has_any_edit(parsed):
            try:
                page_path_clean = page_path.lstrip("/")
                json_path_r = (
                    os.path.join(wiki_root, page_path_clean)
                    if os.path.isabs(wiki_root)
                    else os.path.join(os.path.dirname(__file__), wiki_root, page_path_clean)
                )
                with open(json_path_r, 'r', encoding='utf-8') as f:
                    page_data_r = json.load(f)
                valid_ids = collect_all_block_ids(page_data_r.get("markdown_content", []))
                parsed, discarded = validate_edit_targets(parsed, valid_ids)
                if discarded:
                    agent_logger.warning(f"[QA resume] 丢弃 {discarded} 个非法 target 操作")
            except Exception as e:
                agent_logger.error(f"[QA resume] target 校验加载页面失败: {e}")

        result = _qa_build_return(
            parsed, agent_text, resume_session_id,
            known_wiki_paths=_get_known_wiki_paths(wiki_root),
        )
        t_end = time.time()
        agent_logger.info(
            f"[QA] 恢复完成: 回答长度={len(result.get('answer', ''))}, "
            f"含修改建议={has_any_edit(result)}, 耗时={t_end - t_start:.2f}s"
        )
        agent_logger.info("=" * 60)
        return result

    # ---- 正常模式 ----
    agent_logger.info(f"[QA] 新请求: page_path={page_path}, user_query={user_query}")

    # 1. 加载当前页面
    _progress("正在加载页面数据...")
    page_path_clean = page_path.lstrip("/")
    if os.path.isabs(wiki_root):
        json_path = os.path.join(wiki_root, page_path_clean)
    else:
        json_path = os.path.join(os.path.dirname(__file__), wiki_root, page_path_clean)

    if not os.path.isfile(json_path):
        raise FileNotFoundError(f"Wiki 页面文件不存在: {json_path}")

    with open(json_path, 'r', encoding='utf-8') as f:
        page_data = json.load(f)

    page_content = page_data.get("markdown_content", [])

    # 2. 构建页面结构 + 全页 block 清单（后者供自主修改使用）
    outline = build_page_outline(page_content)
    block_inventory = "\n".join(build_block_inventory(page_content))
    valid_block_ids = collect_all_block_ids(page_content)

    # 3. 提取全页面 neo4j 信息用于关联源码
    all_neo4j_info = {}
    for block in page_content:
        all_neo4j_info.update(extract_neo4j_info(block))

    source_context = ""
    if all_neo4j_info:
        source_lines = []
        for key, info in all_neo4j_info.items():
            src = info["source"]
            nid = info["neo4j_id"]
            if src:
                source_lines.append(f"- [{key}]: 源码路径={src} (neo4j_id={nid})")
        if source_lines:
            source_context = "\n## 关联源码路径\n以下是本页面关联的源码文件，可按需读取：\n" + "\n".join(source_lines)
            source_context += f"\n\n源码根目录: {SOURCE_ROOT_PATH or '(未配置)'}"

    # 4. 构建 prompt（按 user_query 是否含修改信号决定是否注入 SUGGEST_EDIT 相关段）
    allow_suggest_edit = _should_allow_suggest_edit(user_query)
    system_prompt_raw, segment_names = build_qa_system_prompt(allow_suggest_edit)
    system_prompt = system_prompt_raw.replace("{{SOURCE_ROOT_PATH}}", SOURCE_ROOT_PATH or "(未配置)")
    agent_logger.info(
        f"[QA] prompt 段: {'+'.join(segment_names)}, "
        f"allow_suggest_edit={allow_suggest_edit}, system_prompt 字符={len(system_prompt)}"
    )

    wiki_index = _load_wiki_index(wiki_root)
    wiki_overview = _build_wiki_overview(wiki_index, page_path) if wiki_index else ""

    prompt = f"""{system_prompt}
{wiki_overview}

## 当前 Wiki 页面结构（outline）
{outline}

## 当前页 block 清单（可作为 SUGGEST_EDIT 的 target，id 必须从此列表选取）
{block_inventory}
{source_context}

## 用户问题
{user_query}"""

    agent_logger.info(f"[QA] Prompt 构建完成: 长度={len(prompt)}")
    agent_logger.debug(f"[QA] Prompt 完整内容:\n{prompt}")
    _progress("正在调用 AI 模型...")

    # 5. 执行 Claude CLI
    cli_cmd = [
        "claude", "-p", prompt,
        "--model", CLAUDE_MODEL,
        "--output-format", "stream-json",
        "--verbose",
        "--mcp-config", _build_mcp_config(wiki_root),
        "--allowedTools", ALLOWED_TOOLS,
    ]

    agent_text, session_id = await _run_claude_streaming(
        cli_cmd, SOURCE_ROOT_PATH or None, on_progress, on_clarify
    )

    # 6. 解析（含可选 SUGGEST_EDIT）+ target 校验
    parsed = parse_agent_output(agent_text)
    if has_any_edit(parsed):
        parsed, discarded = validate_edit_targets(parsed, valid_block_ids)
        if discarded:
            agent_logger.warning(f"[QA] 丢弃 {discarded} 个非法 target 操作")

    result = _qa_build_return(
        parsed, agent_text, session_id,
        known_wiki_paths=_get_known_wiki_paths(wiki_root),
    )

    t_end = time.time()
    agent_logger.info(
        f"[QA] 完成: answer_len={len(result.get('answer', ''))}, "
        f"含修改建议={has_any_edit(result)}, "
        f"insert={len(result.get('insert_blocks', []))}, "
        f"delete={len(result.get('delete_blocks', []))}, "
        f"replace={len(result.get('replace_blocks', []))}, "
        f"session_id={session_id}, 耗时={t_end - t_start:.2f}s"
    )
    agent_logger.info("=" * 60)
    return result


# ==================== Session 清理 ====================


def cleanup_session(session_id: str) -> dict:
    """
    清理指定 Claude CLI session 的本地存储文件。
    仅允许清理本 agent 创建的 session，防止误删其他会话。

    Claude CLI session 数据分布在以下位置：
    - ~/.claude/projects/<project_dir>/<session_id>.jsonl  (对话记录)
    - ~/.claude/projects/<project_dir>/<session_id>/       (会话目录)
    - ~/.claude/session-env/<session_id>/                  (环境快照)
    - ~/.claude/file-history/<session_id>/                 (文件历史)

    Returns:
        dict: {"deleted": [...], "skipped_reason": str | None}
    """
    if session_id not in _owned_session_ids:
        agent_logger.warning(f"拒绝清理非本 agent 创建的 session: {session_id}")
        return {"deleted": [], "skipped_reason": "session 不属于本 agent"}

    import shutil
    claude_home = os.path.expanduser("~/.claude")
    deleted = []

    # 1. projects 目录下的 .jsonl 文件和同名目录
    projects_dir = os.path.join(claude_home, "projects")
    if os.path.isdir(projects_dir):
        for project in os.listdir(projects_dir):
            project_path = os.path.join(projects_dir, project)
            if not os.path.isdir(project_path):
                continue
            # .jsonl 文件
            jsonl_file = os.path.join(project_path, f"{session_id}.jsonl")
            if os.path.isfile(jsonl_file):
                os.remove(jsonl_file)
                deleted.append(jsonl_file)
            # 同名目录
            session_dir = os.path.join(project_path, session_id)
            if os.path.isdir(session_dir):
                shutil.rmtree(session_dir)
                deleted.append(session_dir)

    # 2. session-env
    session_env_dir = os.path.join(claude_home, "session-env", session_id)
    if os.path.isdir(session_env_dir):
        shutil.rmtree(session_env_dir)
        deleted.append(session_env_dir)

    # 3. file-history
    file_history_dir = os.path.join(claude_home, "file-history", session_id)
    if os.path.isdir(file_history_dir):
        shutil.rmtree(file_history_dir)
        deleted.append(file_history_dir)

    _owned_session_ids.discard(session_id)
    agent_logger.info(f"Session 清理完成: {session_id}, 删除 {len(deleted)} 项: {deleted}")
    return {"deleted": deleted, "skipped_reason": None}
