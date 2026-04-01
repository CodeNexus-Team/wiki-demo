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
SOURCE_ROOT_PATH = os.environ.get("SOURCE_ROOT_PATH", "/Users/uinas/code/wiki-demo/wiki-demo/frontend/public/source-code/mall")

# ==================== System Prompt ====================

CLARIFICATION_PREFIX = "@@CLARIFY@@"

SYSTEM_PROMPT = """你是 Wiki 文档编辑器。用户选中了一些内容块并提出修改需求。

## 核心原则
- 禁止凭空编造内容。所有描述必须基于实际源码或 Neo4j 图谱数据
- 在输出修改前，你必须先通过工具查阅相关源码文件或 Neo4j 数据，确认事实后再撰写
- 如果工具不可用或查不到数据，只能基于用户提供的已有 block 内容进行润色改写，不得添加未经验证的技术细节
- source_ids 中填写的 ID 必须来自页面已有的源码引用，或者你通过工具确认存在的文件

## 澄清机制
在执行任何修改之前，你必须先判断用户指令是否足够明确。以下情况必须触发澄清：
- 用户指令仅包含"优化"、"改一下"、"调整"、"处理"等笼统词汇，未说明具体方向
- 用户指令与选中的多个 block 关系不明确
- 用户指令存在多种合理解读方式

触发澄清时，只输出以下格式，不要输出修改指令，也不要读取源码：
@@CLARIFY@@
你的问题描述（一行）
- 选项1
- 选项2
- 选项3
- 其他（请在输入框说明）

要求：
- 第一行是问题描述
- 随后提供 3~5 个可选方向，每行以 `- ` 开头
- 最后一个选项固定为"其他（请在输入框说明）"
- 选项要简洁，让用户一眼看懂
- 选项尽量与用户所选内容相关
- 问题描述中不要使用 block ID（如 [S73]），应使用该内容块的标题或内容摘要来指代，例如"你希望对「模块功能概述」这段内容做哪种修改？"

等待用户在下一轮对话中选择后再继续执行修改。

## 工作流程
1. 阅读用户选中的内容和修改需求
2. 根据"关联源码路径"信息，使用 Read 工具直接读取对应源码文件，获取准确的实现细节
3. 如需进一步搜索相关代码，使用 Grep 在源码目录中搜索关键类名、方法名等
4. 仅当需要查询跨模块调用链、继承关系等实体关系时，才使用 `query_neo4j` 工具查询 Neo4j 知识图谱
5. 基于查到的事实数据输出修改指令
6. 源码根目录在 {{SOURCE_ROOT_PATH}}
## 输出格式
修改指令可包含多个操作，每个操作用 === 分隔。

每个操作的格式：
---
action: replace 或 insert_after 或 delete
target: 目标block的ID
source_ids: 关联的源码ID，逗号分隔（可选）
---
修改后的 markdown 正文（delete 操作不需要正文）

示例（两个操作）：
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

## 格式规则
- action 三选一：replace（替换目标block内容）、insert_after（在目标block后插入）、delete（删除目标block）
- target 必须是页面中已有的 block ID
- markdown 内容使用中文
- 只输出修改指令，不要输出解释文字"""

QA_SYSTEM_PROMPT = """你是代码知识问答助手。用户正在浏览一份基于源码生成的 Wiki 文档，并对其中的内容或关联的源码提出问题。

## 核心原则
- 回答必须基于实际源码或 Wiki 文档内容，禁止凭空编造
- 优先使用 Read 工具读取源码文件获取准确信息，再用 Grep 搜索补充
- 仅当需要查询跨模块关系时使用 query_neo4j
- 如果无法通过工具获取信息，坦诚说明而非猜测

## 工作流程
1. 理解用户的问题，结合提供的 Wiki 页面内容和结构
2. 根据"关联源码路径"信息，使用 Read 工具读取对应源码
3. 如需搜索更多代码，使用 Grep 搜索
4. 基于事实给出清晰、准确的回答
5. 源码根目录在 {{SOURCE_ROOT_PATH}}

## 输出格式
- 使用中文回答
- 用 markdown 格式组织回答
- 适当引用源码片段说明问题
- 回答要简洁明了，直击问题核心"""

# ==================== MCP Server 配置 ====================

# Neo4j MCP Server 脚本路径
NEO4J_MCP_SERVER_PATH = os.path.join(os.path.dirname(__file__), "neo4j_mcp_server.py")

def _build_mcp_config() -> str:
    """生成临时 MCP 配置文件，返回文件路径"""
    config = {
        "mcpServers": {
            "neo4j-knowledge-graph": {
                "command": "python",
                "args": [NEO4J_MCP_SERVER_PATH]
            }
        }
    }
    tmp = tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False, prefix='mcp_config_')
    json.dump(config, tmp, ensure_ascii=False)
    tmp.close()
    agent_logger.info(f"MCP 配置文件: {tmp.name}")
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


def parse_agent_output(raw_text: str) -> dict:
    """
    解析模型输出的精简修改指令，转换为 PageDiffResponse 格式。

    模型输出格式：
    ---
    action: replace|insert_after|delete
    target: block_id
    source_ids: 1, 2（可选）
    ---
    markdown 正文
    ===（多个操作的分隔符）
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
                        if on_progress:
                            if tool_name == "Read":
                                fp = tool_input.get("file_path", "")
                                short = fp.split("/")[-1] if fp else "文件"
                                on_progress(f"正在读取源码: {short}")
                            elif tool_name == "Grep":
                                on_progress(f"正在搜索代码: {tool_input.get('pattern', '')[:40]}")
                            elif "neo4j" in tool_name.lower():
                                on_progress("正在查询知识图谱...")
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
            "--mcp-config", _build_mcp_config(),
            "--allowedTools", "mcp__neo4j-knowledge-graph__query_neo4j",
        ]

        agent_text, _ = await _run_claude_streaming(
            cli_cmd, SOURCE_ROOT_PATH or None, on_progress
        )

        # 恢复后仍然可能再次澄清（复用统一处理逻辑）
        clarify_result = await _handle_clarification(agent_text, resume_session_id)
        if clarify_result is not None:
            return clarify_result

        _progress("AI 分析完成，正在解析修改指令...")
        result = parse_agent_output(agent_text)
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

    # 6. 构建精简 prompt
    system_prompt = SYSTEM_PROMPT.replace("{{SOURCE_ROOT_PATH}}", SOURCE_ROOT_PATH or "(未配置)")
    prompt = f"""{system_prompt}

## 页面结构概览
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
        "--mcp-config", _build_mcp_config(),
        "--allowedTools", "mcp__neo4j-knowledge-graph__query_neo4j",
    ]

    agent_text, session_id = await _run_claude_streaming(
        cli_cmd, SOURCE_ROOT_PATH or None, on_progress
    )

    cli_duration = time.time() - t_prompt_ready
    agent_logger.info(f"模型输出长度: {len(agent_text)}")
    agent_logger.debug(f"模型输出内容:\n{agent_text}")

    # 8. 检测澄清请求（复用统一处理逻辑）
    clarify_result = await _handle_clarification(agent_text, session_id)
    if clarify_result is not None:
        return clarify_result

    # 9. 解析模型输出 → PageDiffResponse
    _progress("AI 分析完成，正在解析修改指令...")
    result = parse_agent_output(agent_text)

    t_end = time.time()
    total_duration = t_end - t_start
    agent_logger.info(f"完成: 插入={len(result['insert_blocks'])}, 删除={len(result['delete_blocks'])}, "
                      f"CLI耗时={cli_duration:.2f}s, 总耗时={total_duration:.2f}s")
    agent_logger.info("=" * 60)
    return result


async def run_qa_query(
    page_path: str,
    user_query: str,
    wiki_root: str,
    on_progress: Optional[callable] = None,
) -> str:
    """
    Wiki & 源码自由问答智能体。

    Args:
        page_path: 当前 Wiki 页面路径
        user_query: 用户问题
        wiki_root: Wiki 文件根目录
        on_progress: 可选进度回调

    Returns:
        str: markdown 格式的回答文本
    """
    def _progress(msg: str):
        if on_progress:
            on_progress(msg)

    t_start = time.time()
    agent_logger.info("=" * 60)
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

    # 2. 构建页面概览和全文摘要
    outline = build_page_outline(page_content)

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

    # 4. 构建 prompt
    system_prompt = QA_SYSTEM_PROMPT.replace("{{SOURCE_ROOT_PATH}}", SOURCE_ROOT_PATH or "(未配置)")
    prompt = f"""{system_prompt}

## 当前 Wiki 页面结构
{outline}
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
        "--mcp-config", _build_mcp_config(),
        "--allowedTools", "mcp__neo4j-knowledge-graph__query_neo4j",
    ]

    agent_text, _ = await _run_claude_streaming(
        cli_cmd, SOURCE_ROOT_PATH or None, on_progress
    )

    t_end = time.time()
    agent_logger.info(f"[QA] 完成: 回答长度={len(agent_text)}, 耗时={t_end - t_start:.2f}s")
    agent_logger.info("=" * 60)
    return agent_text
