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
import urllib.parse
from typing import List, Dict, Any, Optional


def _build_wiki_link_url(path: str) -> str:
    """
    把 wiki 相对路径编码成可安全嵌入 markdown `[text](url)` 语法的 wiki:// URL。

    Markdown URL 不允许裸空格、括号等字符,中文 wiki 路径里常常有空格(例如
    `HTTP 客户端消息域/请求响应与调用控制.json`),不编码的话 react-markdown
    会把空格当 URL 结束,前端收到的 href 会被截断。
    用 urllib.parse.quote 只 encode 空格和非 URL-safe 字符,保留 `/` 便于阅读。

    前端 ChatMessage 的 a 组件会对切出来的 path 做 decodeURIComponent 还原。
    """
    return "wiki://" + urllib.parse.quote(path, safe="/")

# ==================== 日志配置 ====================

LOG_DIR = os.path.join(os.path.dirname(__file__), "logs")
os.makedirs(LOG_DIR, exist_ok=True)

agent_logger = logging.getLogger("agent")
agent_logger.setLevel(logging.DEBUG)
_handler = logging.FileHandler(os.path.join(LOG_DIR, "agent.log"), encoding="utf-8")
_handler.setFormatter(logging.Formatter("%(asctime)s [%(levelname)s] %(message)s"))
agent_logger.addHandler(_handler)
   
# ==================== 配置 ====================

def _env_str(name: str, default: str) -> str:
    """读取 env 字符串变量,对空字符串容错回退默认值。
    .env 里 KEY= (空值) 时 os.environ.get(name, default) 会返回 ""(不会用 default),
    空串传给下游(比如 claude CLI --model)会 400。
    """
    return ((os.environ.get(name, "") or "").strip()) or default


def _env_int(name: str, default: int) -> int:
    """读取 env 整数变量,对空字符串/非数字容错回退默认值。
    .env 文件可能把未配置的变量写成 KEY= (空值),直接 int("") 会抛 ValueError。
    """
    raw = (os.environ.get(name, "") or "").strip()
    if not raw:
        return default
    try:
        return int(raw)
    except ValueError:
        return default


CLAUDE_MODEL = _env_str("CLAUDE_MODEL", "sonnet")  # claude CLI 支持: sonnet, opus, haiku


CLAUDE_MAX_TOKENS = _env_int("CLAUDE_MAX_TOKENS", 4096)  # 限制输出 token 数加速响应
MAX_TOOL_ROUNDS = _env_int("MAX_TOOL_ROUNDS", 15)
SOURCE_ROOT_PATH = os.environ.get("SOURCE_ROOT_PATH", "")

# 追踪本 agent 创建的所有 session_id，用于安全清理
_owned_session_ids: set = set()

# session_id → 上次请求的 page_path,用于判断 resume 是否跨页
# 跨页追问时,后端在 user_query 前注入新页面的 outline/block_inventory/source_context,
# 让模型基于新页面回答后续问题,同时保留 session 历史(维持对话连续性)
_session_last_page: Dict[str, str] = {}

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


def _append_wiki_references(answer: str, visited_paths: list, known_paths: Optional[set] = None) -> str:
    """
    在 QA 回答末尾追加一个"参考页面"段,列出本次请求中模型通过 wiki-reader 工具访问过的 wiki 页面。

    - visited_paths: 本次请求 _run_claude_streaming 收集到的 wiki 页面路径(首次访问顺序)
    - known_paths: 可选的合法路径集合(来自 wiki_index),用于过滤掉模型手写的错误路径
    - 每个路径渲染为 markdown 链接 `[basename](wiki://path)`,前端 ChatMessage 会渲染成可点击按钮
    - 幂等: 如果 answer 末尾已经有参考段(含 `## 参考页面`),不重复追加
    """
    if not visited_paths:
        return answer

    # 去重(保持首次访问顺序)+ 过滤:只保留真实存在的 wiki 路径(如果提供了 known_paths)
    seen: set = set()
    filtered: list = []
    for p in visited_paths:
        if p in seen:
            continue
        seen.add(p)
        if known_paths is not None and p not in known_paths:
            continue
        filtered.append(p)

    if not filtered:
        return answer

    # 幂等: 防止追问 resume 场景重复追加
    if "## 参考页面" in answer:
        return answer

    lines = ["", "", "---", "", "## 参考页面"]
    for p in filtered:
        display = os.path.splitext(os.path.basename(p))[0]
        lines.append(f"- [{display}]({_build_wiki_link_url(p)})")

    return answer.rstrip() + "\n".join(lines)


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
        link_md = f"[{display}]({_build_wiki_link_url(path)})"
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


def _build_current_page_context(page_path: str, wiki_root: str) -> tuple:
    """
    构建 resume 跨页追问时注入的"当前页上下文"三段(outline / block_inventory / source_context)。
    返回 (outline, block_inventory, source_context) 字符串元组。
    任一段加载失败返回空字符串(保证调用方鲁棒)。
    """
    try:
        page_path_clean = page_path.lstrip("/")
        abs_root = _resolve_wiki_root(wiki_root)
        json_path = os.path.join(abs_root, page_path_clean)
        if not os.path.isfile(json_path):
            agent_logger.warning(f"[resume inject] 页面文件不存在: {json_path}")
            return "", "", ""
        with open(json_path, "r", encoding="utf-8") as f:
            page_data = json.load(f)
        page_content = page_data.get("markdown_content", [])

        outline = build_page_outline(page_content)
        block_inventory = "\n".join(build_block_inventory(page_content))

        # 全页 neo4j 源码路径
        all_neo4j_info: dict = {}
        for block in page_content:
            all_neo4j_info.update(extract_neo4j_info(block))
        source_lines = []
        for key, info in all_neo4j_info.items():
            src = info.get("source")
            nid = info.get("neo4j_id")
            if src:
                source_lines.append(f"- [{key}]: 源码路径={src} (neo4j_id={nid})")
        source_context = ""
        if source_lines:
            source_context = (
                "\n## 关联源码路径\n以下是本页面关联的源码文件,可按需读取:\n"
                + "\n".join(source_lines)
                + f"\n\n源码根目录: {SOURCE_ROOT_PATH or '(未配置)'}"
            )
        return outline, block_inventory, source_context
    except Exception as e:
        agent_logger.warning(f"[resume inject] 构建当前页上下文失败: {e}")
        return "", "", ""


def _build_resume_user_prompt(
    user_query: str,
    page_path: str,
    wiki_root: str,
    allow_edit: bool = False,
) -> str:
    """
    resume 追问时,在 user_query 前注入额外上下文段。
    - 跨页场景: 注入当前页的 outline / block_inventory / source_context,明确"以此为准"
    - 修改意图场景: 额外注入 PROMPT_EDIT_PROTOCOL 和 PROMPT_CLARIFY_FOR_EDIT 段
      (解决 session 血统为 QA 时原本 system prompt 里没有修改协议的问题)

    allow_edit: 是否启用修改意图注入。当前所有 resume 路径都传 True(模型自行判定意图)。
    """
    outline, block_inventory, source_context = _build_current_page_context(page_path, wiki_root)
    # 上下文加载失败,退化为原始 user_query(避免发出残缺的指令)
    if not outline and not block_inventory:
        return user_query

    # 可选的修改协议段(临时补齐 session 原本缺失的修改能力)
    edit_protocol_block = ""
    if allow_edit:
        edit_protocol_block = f"""

**修改协议补充(重要)** —— 用户可能要求修改内容,请严格按下面协议输出结构化修改指令:

{PROMPT_EDIT_PROTOCOL}

{PROMPT_CLARIFY_FOR_EDIT}

不要用自然语言"建议替换 xxx 为..."描述修改,必须用上面的 `---/===` 结构化格式,
否则前端解析不到修改指令,用户将看不到 diff 预览。

"""

    return f"""[系统上下文更新 — 当前页面:「{page_path}」]

从此条消息开始,后续对话基于**新页面**。请忽略之前对话中提到的 block 清单、outline 和关联源码路径,
以下面为准。**所有输出必须使用中文**。{edit_protocol_block}
## 当前 Wiki 页面结构(outline)
{outline}

## 当前页 block 清单(请以此为准,忽略历史对话里的旧清单)
{block_inventory}
{source_context}

---

## 用户问题
{user_query}"""


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
#   - 共享段（被两个路径复用）:INTENT_DETECTION / CLARIFY_BASE / CROSS_PAGE / EDIT_PROTOCOL / CLARIFY_FOR_EDIT / EDIT_WORKFLOW
#   - QA 路径专属:QA_IDENTITY / QA_FORMAT_BASIC / FEATURE_PLAN / SUGGEST_EDIT / EDIT_EXAMPLES
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


PROMPT_CROSS_PAGE = """## 跨页查阅(**结构性问题必须先走这一步**)
结构性问题(架构/对比/区别/分布/调用链/关系/设计/组织/在哪里/涉及哪些)以及需求/问题涉及
**当前页以外**的模块时,请先查看 prompt 中的「Wiki 总览」段落,从中挑选 1~2 个最相关的页面,
然后使用 `wiki-reader` MCP 工具按相对路径读取:
- `get_page_outline(path)` — 只返回结构大纲,快速定位
- `read_wiki_page(path)` — 读取精简的 block 树(已去除 neo4j 元数据)
- `read_wiki_section(path, section_id)` — 精准读取某个 block 及其子树
- `list_wiki_pages(prefix)` — 按前缀列出可用页面

path 直接使用总览表中的相对路径(如 `门户系统/订单管理.json`),不要拼绝对路径。

**典型错误模式(不要这样做)**: 看到"X 和 Y 的区别"、"X 在哪里"这类结构性问题,立刻去 Grep/Read
源码寻找实现细节,试图通过读源码来回答架构问题。**正确做法**: 先从「Wiki 总览」里找 X 和 Y 对应
的专门页面(例如问"OkHttp 和 Servlet 架构区别"应先读 `HTTP 客户端消息域` 和 `Servlet 请求响
应与过滤` 两个页面),用 wiki-reader 读取后再对比。源码只用于验证 wiki 里的具体细节,不能代替
wiki 的结构化描述。即便当前页已经提到了相关模块的名字(如总揽页),只要 wiki 有更详细的专门页面,
就必须先读专门页面。

仅在 wiki 确实无法覆盖某个细节时,才去搜源码或查 Neo4j。不要盲目 Grep 所有源码。"""


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
- 回答必须基于实际 Wiki 文档或源码内容,禁止凭空编造
- **优先使用 Wiki 回答,源码只用于验证细节**
- 如果无法通过工具获取信息,坦诚说明而非猜测

## 工作流程(**按问题类型分流,必须遵守优先级**)

**第一步:判断问题类型**
- **结构性问题**: 问"在哪里/哪些模块/架构/对比/区别/分布/调用链/关系/设计/如何组织/原理/流程"等
  → 走"结构性问题处理流程"
- **实现细节问题**: 问"某行代码做什么/某参数含义/具体方法签名/字段类型"等
  → 走"实现细节处理流程"
- 不确定时默认按结构性问题处理

**结构性问题处理流程**:
1. 结合「Wiki 总览」段落判断用户问题关联到哪几个 wiki 页面
2. **必须**使用 `wiki-reader` MCP 工具读取这 1~2 个最相关页面(`get_page_outline` 或 `read_wiki_page`),
   然后基于读到的 wiki 内容组织回答
3. 只有在 wiki 页面没有足够细节时,才**补充性**地用 Read 读源码验证
4. **严禁**跳过 wiki 直接 Grep/Read 源码来回答结构性问题

**实现细节处理流程**:
1. 根据"关联源码路径"使用 Read 工具读取对应源码
2. 如需搜索更多代码,使用 Grep
3. 基于源码事实回答
4. 如果读源码后发现涉及跨模块的结构性上下文,再回头走结构性问题流程补读 wiki

**通用规则**:
- 跨模块关系用 `query_neo4j`
- 源码根目录在 {{SOURCE_ROOT_PATH}}
- 基于事实给出清晰、准确的回答

## 搜索边界(避免无谓搜索,重要)

当 wiki 介绍的是**第三方库/框架本身**(例如 OkHttp、Spring、Jackson、Servlet API、JDK NIO 等
这类通用基础设施/标准库/开源库)时,**项目源码里通常不会有这些库的实现源码**——它们以 jar 依赖
的形式存在于 Maven/Gradle 仓库,不会出现在 `{{SOURCE_ROOT_PATH}}` 里。

遇到这种情况,**不要**盲目 Glob/Grep/Bash find 去找 `okhttp3/` 或 `javax/servlet/` 这类目录,
那些尝试必然失败,浪费时间和 token。正确做法:

1. **主要信息来源是 wiki** —— 用 `wiki-reader` 工具读取相关 wiki 页面,wiki 已经写好了框架本身的
   抽象和用法说明
2. **如果用户关心项目里如何使用这个库**,搜索**使用方代码**(业务代码里 import 这个库的地方),
   例如 `ruoyi-system/.../HttpClients.java` 这种 —— 这在项目里存在
3. **只有** 在 wiki 不够用且用户明确问实现细节时,才去 Read 源码,此时也要先缩小范围
   (用 Glob 的 pattern 精准定位使用方,而不是漫无目的地 find)

**反面示例**:问 OkHttp 的架构 → 连续调用 15+ 次 Glob/Grep/Bash 找 okhttp3 目录 → 什么都找不到
 → 浪费 5 分钟 + 上千 token。**正确做法**:直接 `wiki-reader.read_wiki_page` 读 wiki,回答完成。"""


PROMPT_QA_FORMAT_BASIC = """## 输出格式(必须严格遵守)
回答必须以 `@@QA_ANSWER@@` 开头(作为响应的第一行),后接 markdown 正文:

```
@@QA_ANSWER@@
(markdown 格式的回答,可引用源码片段,使用中文)
```

- 简洁明了,直击问题核心
- 适当引用源码片段
- 当提到具体 wiki 页面的相对路径时(例如 `门户系统/主程序/订单退货服务.json`),直接写路径即可,后端会自动识别并生成可点击链接"""


PROMPT_FEATURE_PLAN = """## 实现建议类问题(QA 子分类)

**触发条件**:用户问"如何加 / 想新增 / 想实现 / 扩展 / 加个 X 功能 / 这样改要怎么写"等
——询问**未来该怎么写代码**,而非问现状("X 是什么/在哪/怎么实现的")。

**调研步骤(必须先做再回答,缺一不可)**:
1. 用 `wiki-reader` 读相关 wiki 页面,理解模块边界与项目分层
2. 用 Grep 在 `{{SOURCE_ROOT_PATH}}` 找已存在的相似功能,作为新代码的范式
3. 用 Read 打开 1~3 个最相似的现有文件,确认包名/命名/注解/注入风格
4. 涉及实体或调用链时,`query_neo4j` 或读 wiki 的 ER/调用图

**输出格式(仍以 `@@QA_ANSWER@@` 起始,markdown 正文按下列三段)**:

```
@@QA_ANSWER@@
## 影响范围
- `path/to/A.java`(新增)— 一句话说明
- `path/to/B.java`(修改)— 一句话说明

## 实现建议
针对每个文件给一段代码块:
- **新增文件**:完整骨架(package + import + 类/方法签名 + 关键逻辑)
- **修改文件**:unified diff,只贴 delta 行,前后留 1~2 行 context

代码块**必须**带语言标签(java / ts / sql / yaml ...),便于前端语法高亮。

## 集成与验证
1. 配置 / 数据库迁移变更(如有)
2. 测试入口(具体测试类或验证方式)
3. 上下游接口变更点
```

**硬性要求**:
- 文件路径基于实际 Grep/Read 结果,**不得编造**;不确定就声明"建议放在 X 包下,具体位置参考同类文件"
- 复用项目现有的命名 / 注解 / 分层风格,与既有代码一致
- 聚焦 delta,不要重述既有代码

**不触发本流程的情况**:
- 问"X 在哪 / X 是怎么实现的(问现状)" → 走原有结构性 / 实现细节流程
- 单纯改 wiki 文档的诉求 → 按 INTENT_DETECTION 走修改类(直接吐协议指令,不走本节)"""


PROMPT_SUGGEST_EDIT = """## 可选的修改建议(QA 顺手建议路径,严格条件触发)

本段适用场景: 模型按 INTENT_DETECTION 判断是**提问类**(已经决定输出 `@@QA_ANSWER@@`),
但在回答过程中**通过工具发现 wiki 与源码不一致**或用户隐含暗示要改 —— 此时可以在
QA 答案末尾追加一段修改建议,用 `@@SUGGEST_EDIT@@` 作为分隔标记。

**严格触发条件(只在以下任一情况下追加,其余一律不要)**:
1. **事实性冲突** — 用 Read 读源码后发现某 block 的描述与源码不符(签名变了/字段被删/已过时)
2. **用户隐含暗示但未明确要求修改** — 提问中带"是不是写错了 / 这里好像不准确"等弱信号

**严禁触发**:
- ❌ 用户已经明确要求修改(那应该让 INTENT_DETECTION 走修改类直接吐协议,**不要**走 QA + SUGGEST_EDIT)
- ❌ 主观判断"可以更详细 / 更清晰 / 缺示例"
- ❌ 顺手改一下、无中生有
- ❌ 匹配不到 target 时蒙一个 —— 必须调 `ask_user` 澄清

触发时的输出格式:

```
@@QA_ANSWER@@
(完整回答)

@@SUGGEST_EDIT@@
---
action: replace | insert_after | delete
target: 当前页 block 清单里真实存在的 id
source_ids: 关联源码 ID,逗号分隔(可选)
---
修改后的 markdown 正文
===
```

target / source_ids / 协议细节见「修改输出协议」与「修改目标澄清」段。"""


PROMPT_EDIT_EXAMPLES = """## SUGGEST_EDIT 触发判断示例

| 用户问题 | 触发? | 理由 |
|---|---|---|
| "订单提交的入口是什么?" | ❌ | 纯提问 |
| "订单状态那里写错了吧,源码里是 7 种" | ✅ | 隐含暗示 + 通过 Read 验证后是事实性冲突 |
| "登录流程有 JWT 吗?" | ❌ | 纯提问,即使发现 wiki 描述可改善也不触发 |
| "这个模块的架构能写得再详细点吗?" | ❌ | 主观判断 |
| "把【订单创建流程】那段改简洁点" | ❌ → INTENT_DETECTION 走修改类 | 用户已明确要求修改,不走 QA |
| "这段内容改一下" | ❌ → 调 ask_user | 模糊指代必须澄清 |
| "把所有提到 OrderService 的地方都补充调用链" | ❌ → 调 ask_user | 规模过大且目标不唯一 |"""


# ---- Detailed 路径专属段 ----

PROMPT_DETAILED_IDENTITY = """你是 Wiki 文档助手。用户选中了一些内容块并提出了需求。

## 核心原则
- 禁止凭空编造内容。所有描述必须基于实际源码或 Neo4j 图谱数据
- 你必须先通过工具查阅相关源码文件或 Neo4j 数据,确认事实后再撰写
- 如果工具不可用或查不到数据,只能基于用户提供的已有 block 内容进行回答或润色改写,不得添加未经验证的技术细节
- source_ids 中填写的 ID 必须来自页面已有的源码引用,或者你通过工具确认存在的文件

## 搜索边界(避免无谓搜索,重要)

当 wiki 介绍的是**第三方库/框架本身**(例如 OkHttp、Spring、Jackson、Servlet API、JDK 标准库 等
通用基础设施/标准库/开源库)时,**项目源码里通常不会有这些库的实现源码**——它们以 jar 依赖的形式
存在于 Maven/Gradle 仓库,不会出现在 `{{SOURCE_ROOT_PATH}}` 里。

遇到这种情况,**不要**盲目 Glob/Grep/Bash find 去找 `okhttp3/` 或 `javax/servlet/` 这类目录。
正确做法:

1. 用 `wiki-reader` MCP 工具读取相关 wiki 页面,wiki 已经写好了框架本身的抽象
2. 如果修改需求涉及"项目里如何使用这个库",搜索**使用方代码**(业务代码里 import 这个库的地方),
   而不是搜库本身
3. 只有当明确需要查具体实现细节时才 Read 源码,且要先缩小范围

**反面示例**: 看到 wiki 写 OkHttp 就去 Glob/Grep/Bash find 找 okhttp3 目录 → 全部失败 →
浪费大量时间和 token。"""


PROMPT_INTENT_DETECTION = """## 意图判断(最高优先级)
收到用户输入后,**先按以下顺序套用规则**:命中前者就停,不再考虑后者。

### 第 1 优先级: 修改类(动作对象 = 当前 wiki 文档文字)
**判定**: 用户的诉求是"对当前 wiki 页面/选中 block 的文字内容做改动"——改成 / 改得 / 改简 / 改详 / 加上 / 补上 / 删掉 / 重写 / 整理 / 改条目式 / 改成表格 / 漏了/写错了 等。
**关键问自己**: "他要我修改的是 wiki 上的文字,还是要我帮他写源码?"——如果是前者,就是修改类。

正例(全部走修改流程,**不**输出 `@@QA_ANSWER@@`):
- "把第二章改简洁点" → 修改 wiki 第二章文字
- "这段太啰嗦改简洁点 / 重写一下" → 修改选中 block 文字
- "把这段改成条目式 / 改成表格" → 修改 wiki 文字结构
- "这一节漏了对 XX 字段的说明,补上" → 给 wiki 补内容
- "这里写错了,应该是 YYY" → 修改 wiki 文字
- "把第三章删掉" → 删 wiki block

输出: **直接执行**「修改工作流程」并按「修改输出协议」输出修改指令——也就是直接吐 `--- action: ... target: ...` 这种结构化文本。

**严禁的反模式**(下面这些都是错误,会被前端判为 QA):
- ❌ 输出"当前 X 的原文: ...建议改为: ...如需应用请告诉我" —— 这是 QA 风格的征求同意,不要这样写
- ❌ 在 `@@QA_ANSWER@@` 里描述"我打算怎么改" —— 用户已经有 Diff 预览面板,直接吐修改指令即可,他会自己决定是否应用
- ❌ 输出 `@@QA_ANSWER@@` 任何前缀 —— 修改类**严禁**带 QA 前缀,前端按前缀分流;唯一例外是「QA + SUGGEST_EDIT」混合(见 SUGGEST_EDIT 段),那是提问类的子模式不是修改类
- ❌ 用自然语言说"我可以帮你改成 XXX,要我应用吗?" —— 不需要确认,直接产出协议

### 第 2 优先级: 提问类(动作对象 = 信息/知识/源码)
统一输出 `@@QA_ANSWER@@`。三个子型:

1. **结构性 / 实现细节** — "是什么 / 为什么 / 怎么 / 有哪些 / 调用关系 / 区别 / 解释 / 在哪 / 怎么实现的(问现状)"
2. **源码逻辑追问** — 针对当前文档涉及的源码原理 / 异常处理 / 算法的追问
3. **实现建议(询问未来代码该怎么写)** — 用户问"如何新增 X 功能 / 如何扩展 Y 模块 / 想加个 Z 功能,代码怎么写 / 怎么实现",
   询问**对象是项目源码**而非 wiki,按「实现建议类问题」段的三段式输出

正例:
- ✅ "WlxIntegralRecord 表怎么记录积分变动的?" → 提问(问现状)
- ✅ "如何新增一个居民收藏功能,代码怎么写?" → 提问(实现建议) —— 改源码不是改 wiki
- ✅ "扩展抽奖模块支持保底机制要怎么写代码?" → 提问(实现建议)

### 反例对照(同一个动词,不同归类)
- "**新增**一个居民收藏功能,**代码怎么写**" → **提问类**(动作对象=源码)
- "在第二章**新增**一段对收藏功能的介绍" → **修改类**(动作对象=wiki 文字)
- "**改简洁**点" → **修改类**(动作对象=wiki 文字)
- "**改**用 Redis 实现签到去重,代码怎么写" → **提问类**(动作对象=源码)

### 模糊类
如果按上述都还判不清,调用 `ask_user` 工具问"是要改 wiki 文档,还是问代码层面怎么写?"。"""


PROMPT_EDIT_WORKFLOW = """## 修改工作流程
1. 阅读用户选中的内容和修改需求
2. 根据"关联源码路径"信息,使用 Read 工具直接读取对应源码文件,获取准确的实现细节
3. 如需进一步搜索相关代码,使用 Grep 在源码目录中搜索关键类名、方法名等
4. 仅当需要查询跨模块调用链、继承关系等实体关系时,才使用 `query_neo4j` 工具查询 Neo4j 知识图谱
5. 基于查到的事实数据输出修改指令
6. 源码根目录在 {{SOURCE_ROOT_PATH}}
7. 只输出修改指令,不要输出解释文字"""


# ==================== Prompt 拼装 ====================

# 意图分类完全交给模型按 PROMPT_INTENT_DETECTION 自行判断,
# 不再做基于关键词命中的硬编码前置过滤 —— 既容易漏判("改简洁点"这种口语化表达),
# 又跟模型的判定结果可能冲突。两条路径都全量注入,模型自行选择输出格式。


def build_qa_system_prompt() -> tuple:
    """
    拼装 QA 路径的 system prompt。
    返回 (prompt_text, segment_names) 用于日志。

    QA 路径同样要支持修改意图(INTENT_DETECTION 让模型自行选择),
    并保留 SUGGEST_EDIT 顺手建议路径(模型读源码后发现 wiki 不准时主动提出)。
    """
    parts = [
        ("QA_IDENTITY", PROMPT_QA_IDENTITY),
        ("INTENT_DETECTION", PROMPT_INTENT_DETECTION),
        ("CLARIFY_BASE", PROMPT_CLARIFY_BASE),
        ("CROSS_PAGE", PROMPT_CROSS_PAGE),
        ("QA_FORMAT_BASIC", PROMPT_QA_FORMAT_BASIC),
        ("FEATURE_PLAN", PROMPT_FEATURE_PLAN),
        ("SUGGEST_EDIT", PROMPT_SUGGEST_EDIT),
        ("EDIT_EXAMPLES", PROMPT_EDIT_EXAMPLES),
        ("CLARIFY_FOR_EDIT", PROMPT_CLARIFY_FOR_EDIT),
        ("EDIT_WORKFLOW", PROMPT_EDIT_WORKFLOW),
        ("EDIT_PROTOCOL", PROMPT_EDIT_PROTOCOL),
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
        ("FEATURE_PLAN", PROMPT_FEATURE_PLAN),
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
    解析模型输出:

    1. 首字符为 @@QA_ANSWER@@ → 提问类
       - 若同时包含 @@SUGGEST_EDIT@@ → 切分两段, QA 部分走答案, 修改部分走协议解析
       - 否则只返回 qa_answer + 空修改字段
    2. 否则 → 修改类, 按修改协议解析
    """
    text = raw_text.strip()

    if text.startswith(QA_ANSWER_PREFIX):
        body = text[len(QA_ANSWER_PREFIX):]
        if SUGGEST_EDIT_PREFIX in body:
            qa_part, _, edit_part = body.partition(SUGGEST_EDIT_PREFIX)
            edit_result = _parse_edit_operations(edit_part.strip())
            return {"qa_answer": qa_part.strip(), **edit_result}
        return {"qa_answer": body.strip(), **_empty_edit_result()}

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
        (agent_text, session_id, visited_wiki_paths):
            - agent_text: 最终结果文本
            - session_id: 本轮会话 ID
            - visited_wiki_paths: 本轮通过 wiki-reader 工具访问过的 wiki 页面相对路径(首次访问顺序,去重)
    """
    # asyncio.StreamReader 默认单行上限 64KB,对 Claude CLI 的 stream-json 不够:
    # 某个 tool_use_result 事件(如 read_wiki_page 返回 30KB JSON 被外层 JSON 再 escape 一次)
    # 单行很容易超过 64KB,会抛 "Separator is found, but chunk is longer than limit"。
    # 提升到 10MB 足以覆盖任何单个工具结果。
    proc = await asyncio.create_subprocess_exec(
        *cli_cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        cwd=cwd,
        limit=10 * 1024 * 1024,
    )

    session_id = None
    agent_text = ""
    # 本次请求中模型通过 wiki-reader 工具访问过的 wiki 页面相对路径(保持首次访问顺序,自动去重)
    visited_wiki_paths: List[str] = []

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
                                # 收集已访问的 wiki 页面(用于回答末尾生成引用段)
                                if wiki_path and wiki_path not in visited_wiki_paths:
                                    visited_wiki_paths.append(wiki_path)
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
                cost = event.get("cost_usd") or event.get("total_cost_usd")
                duration_ms = event.get("duration_ms")
                usage = event.get("usage", {}) or {}
                if cost is not None:
                    agent_logger.info(f"API 费用: ${cost:.4f}")
                if duration_ms is not None:
                    agent_logger.info(f"API 内部耗时: {duration_ms}ms")
                # Token 用量(含 prompt cache 命中情况): 用于事后分析真实用户的成本
                if usage:
                    agent_logger.info(
                        f"Token 用量: new_input={usage.get('input_tokens', 0)}, "
                        f"cache_read={usage.get('cache_read_input_tokens', 0)}, "
                        f"cache_creation={usage.get('cache_creation_input_tokens', 0)}, "
                        f"output={usage.get('output_tokens', 0)}"
                    )

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

    return agent_text, session_id, visited_wiki_paths


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

        # 注入策略: 任何 resume 都补齐当前页上下文 + 修改协议。
        # 修改协议段成本(~1KB tokens)远小于让模型瞎猜导致的失败重试成本,
        # 没必要再做关键词预判。模型按 INTENT_DETECTION 自行选择是否走修改流程。
        last_page = _session_last_page.get(resume_session_id)
        is_cross_page = last_page is not None and last_page != page_path
        if is_cross_page:
            agent_logger.info(f"[Detailed resume] 跨页 {last_page}→{page_path},注入新上下文 + 修改协议")
        else:
            agent_logger.info("[Detailed resume] 同页追问,注入修改协议段")
        prompt_text = _build_resume_user_prompt(
            user_query, page_path, wiki_root, allow_edit=True
        )
        _session_last_page[resume_session_id] = page_path

        cli_cmd = [
            "claude", "--resume", resume_session_id,
            "-p", prompt_text,
            "--output-format", "stream-json",
            "--verbose",
            "--mcp-config", _build_mcp_config(wiki_root),
            "--allowedTools", ALLOWED_TOOLS,
        ]

        agent_text, _, visited_wiki_paths = await _run_claude_streaming(
            cli_cmd, SOURCE_ROOT_PATH or None, on_progress, on_clarify
        )

        # 恢复后仍然可能再次澄清（复用统一处理逻辑，兼容旧会话仍用 @@CLARIFY@@ 的情况）
        clarify_result = await _handle_clarification(agent_text, resume_session_id)
        if clarify_result is not None:
            return clarify_result

        _progress("AI 分析完成，正在解析结果...")
        result = parse_agent_output(agent_text)
        # 对 qa_answer 文本做 wiki 路径链接化 + 追加引用段
        if "qa_answer" in result and result["qa_answer"]:
            known_paths = _get_known_wiki_paths(wiki_root)
            result["qa_answer"] = _linkify_wiki_paths(result["qa_answer"], known_paths)
            result["qa_answer"] = _append_wiki_references(
                result["qa_answer"], visited_wiki_paths, known_paths
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

    agent_text, session_id, visited_wiki_paths = await _run_claude_streaming(
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
    # 对 qa_answer 文本做 wiki 路径链接化 + 追加引用段
    if "qa_answer" in result and result["qa_answer"]:
        known_paths = _get_known_wiki_paths(wiki_root)
        result["qa_answer"] = _linkify_wiki_paths(result["qa_answer"], known_paths)
        result["qa_answer"] = _append_wiki_references(
            result["qa_answer"], visited_wiki_paths, known_paths
        )
    result["session_id"] = session_id  # 供后续追问 --resume
    if session_id:
        _session_last_page[session_id] = page_path  # 记录本次请求的 page_path,供 resume 跨页判断

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
    visited_wiki_paths: Optional[list] = None,
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

    后处理步骤（按顺序）：
      - known_wiki_paths → 对 answer 做 linkify，把裸 wiki 路径替换为 markdown 链接
      - visited_wiki_paths → 在 answer 末尾追加"## 参考页面"段，列出本轮访问过的 wiki 页面
    """
    has_edit_ops = bool(
        parsed.get("insert_blocks") or parsed.get("delete_blocks") or parsed.get("replace_blocks")
    )

    if "qa_answer" in parsed:
        answer_text = parsed["qa_answer"]
    elif has_edit_ops:
        # 模型按 INTENT_DETECTION 判定为修改类,直接吐了纯协议(没有 @@QA_ANSWER@@)。
        # 不要把协议原文当成 answer 显示给用户 —— 前端会基于 insert/replace/delete 字段进入 diff 预览。
        answer_text = ""
    else:
        # 模型既没出 QA 前缀也没出有效修改协议(常见于旧 session resume 退化)。
        # 降级:整段当回答,避免完全静默。
        answer_text = raw_agent_text.strip()

    # 对答案做 wiki 路径硬编码链接化
    if known_wiki_paths:
        answer_text = _linkify_wiki_paths(answer_text, known_wiki_paths)

    # 追加引用段
    if visited_wiki_paths:
        answer_text = _append_wiki_references(answer_text, visited_wiki_paths, known_wiki_paths)

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

        # 注入策略: 同 detailed resume —— 任何 resume 都注入修改协议段,模型自行决定是否使用。
        last_page = _session_last_page.get(resume_session_id)
        is_cross_page = last_page is not None and last_page != page_path
        if is_cross_page:
            agent_logger.info(f"[QA resume] 跨页 {last_page}→{page_path},注入新上下文 + 修改协议")
        else:
            agent_logger.info("[QA resume] 同页追问,注入修改协议段")
        prompt_text = _build_resume_user_prompt(
            user_query, page_path, wiki_root, allow_edit=True
        )
        _session_last_page[resume_session_id] = page_path

        cli_cmd = [
            "claude", "--resume", resume_session_id,
            "-p", prompt_text,
            "--output-format", "stream-json",
            "--verbose",
            "--mcp-config", _build_mcp_config(wiki_root),
            "--allowedTools", ALLOWED_TOOLS,
        ]

        agent_text, _, visited_wiki_paths = await _run_claude_streaming(
            cli_cmd, SOURCE_ROOT_PATH or None, on_progress, on_clarify
        )

        # 解析（QA 或修改协议二选一）
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
            visited_wiki_paths=visited_wiki_paths,
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

    # 4. 构建 prompt(始终全量注入,模型按 INTENT_DETECTION 自行选择问答 vs 修改输出)
    system_prompt_raw, segment_names = build_qa_system_prompt()
    system_prompt = system_prompt_raw.replace("{{SOURCE_ROOT_PATH}}", SOURCE_ROOT_PATH or "(未配置)")
    agent_logger.info(
        f"[QA] prompt 段: {'+'.join(segment_names)}, system_prompt 字符={len(system_prompt)}"
    )

    wiki_index = _load_wiki_index(wiki_root)
    wiki_overview = _build_wiki_overview(wiki_index, page_path) if wiki_index else ""

    prompt = f"""{system_prompt}
{wiki_overview}

## 当前 Wiki 页面结构（outline）
{outline}

## 当前页 block 清单（修改协议中 target 必须从此列表的 id 选取）
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

    agent_text, session_id, visited_wiki_paths = await _run_claude_streaming(
        cli_cmd, SOURCE_ROOT_PATH or None, on_progress, on_clarify
    )

    # 6. 解析（QA 或修改协议二选一）+ target 校验
    parsed = parse_agent_output(agent_text)
    if has_any_edit(parsed):
        parsed, discarded = validate_edit_targets(parsed, valid_block_ids)
        if discarded:
            agent_logger.warning(f"[QA] 丢弃 {discarded} 个非法 target 操作")

    result = _qa_build_return(
        parsed, agent_text, session_id,
        known_wiki_paths=_get_known_wiki_paths(wiki_root),
        visited_wiki_paths=visited_wiki_paths,
    )
    if session_id:
        _session_last_page[session_id] = page_path  # 记录本次请求页面,供 resume 跨页判断

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
    _session_last_page.pop(session_id, None)  # 同步清理跨页追问需要的 session→page 映射
    agent_logger.info(f"Session 清理完成: {session_id}, 删除 {len(deleted)} 项: {deleted}")
    return {"deleted": deleted, "skipped_reason": None}
