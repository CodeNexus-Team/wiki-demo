"""
Wiki 交互式修改智能体

使用 Anthropic Claude API 的 tool use 模式，实现 agentic loop：
Claude 根据用户需求自主决定需要哪些数据源，收集信息后提交结构化修改。
"""

import os
import json
import subprocess
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

SYSTEM_PROMPT = """你是 Wiki 文档编辑器。用户选中了一些内容块并提出修改需求。

## 核心原则
- 禁止凭空编造内容。所有描述必须基于实际源码或 Neo4j 图谱数据
- 在输出修改前，你必须先通过工具查阅相关源码文件或 Neo4j 数据，确认事实后再撰写
- 如果工具不可用或查不到数据，只能基于用户提供的已有 block 内容进行润色改写，不得添加未经验证的技术细节
- source_ids 中填写的 ID 必须来自页面已有的源码引用，或者你通过工具确认存在的文件

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


# ==================== 核心 agentic loop ====================


async def run_detailed_query(
    page_path: str,
    block_ids: List[str],
    user_query: str,
    wiki_root: str,
    on_progress: Optional[callable] = None,
) -> dict:
    """
    使用 Claude agentic loop 处理用户的详细查询请求。

    Args:
        on_progress: 可选的回调函数，接收进度消息字符串。
                     用于 SSE 流式推送给前端。

    Returns:
        dict: PageDiffResponse 或 CreatePageResponse 格式的结果
    """
    def _progress(msg: str):
        if on_progress:
            on_progress(msg)

    t_start = time.time()
    agent_logger.info("=" * 60)
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
    print(f"[Agent] 调用 claude CLI (model={CLAUDE_MODEL}), prompt长度={len(prompt)}")

    t_cli_start = time.time()
    # 构建 CLI 命令，附加 Neo4j MCP Server
    cli_cmd = [
        "claude", "-p", prompt,
        "--model", CLAUDE_MODEL,
        "--output-format", "stream-json",
        "--verbose",
        "--mcp-config", _build_mcp_config(),
        "--allowedTools", "mcp__neo4j-knowledge-graph__query_neo4j",
    ]

    def _run_cli():
        return subprocess.run(
            cli_cmd,
            capture_output=True,
            text=True,
            timeout=120,
            cwd=SOURCE_ROOT_PATH or None,
        )

    try:
        # Run in thread pool so the event loop stays free for other requests
        # (e.g. fetch_page) while the CLI is executing.
        cli_result = await asyncio.to_thread(_run_cli)
    except FileNotFoundError:
        raise RuntimeError("未找到 claude CLI，请确认已安装 Claude Code")
    except subprocess.TimeoutExpired:
        raise TimeoutError("claude CLI 调用超时（120秒）")

    t_cli_end = time.time()
    cli_duration = t_cli_end - t_cli_start
    agent_logger.info(f"Claude CLI 调用完成: 耗时={cli_duration:.2f}s, returncode={cli_result.returncode}")

    if cli_result.returncode != 0:
        agent_logger.error(f"Claude CLI 失败: {cli_result.stderr}")
        print(f"[Agent] claude CLI 错误: {cli_result.stderr}")
        raise RuntimeError(f"claude CLI 调用失败: {cli_result.stderr}")

    # 解析 stream-json 输出：每行一个 JSON 事件
    raw_output = cli_result.stdout.strip()
    agent_text = ""
    for line in raw_output.split("\n"):
        line = line.strip()
        if not line:
            continue
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            continue

        event_type = event.get("type", "")
        event_subtype = event.get("subtype", "")
        message = event.get("message", {})

        # assistant 事件：解析 message.content 中的工具调用和文本
        if event_type == "assistant" and isinstance(message, dict):
            content_blocks = message.get("content", [])
            if isinstance(content_blocks, list):
                for block in content_blocks:
                    if not isinstance(block, dict):
                        continue
                    block_type = block.get("type", "")

                    if block_type == "tool_use":
                        tool_name = block.get("name", "unknown")
                        tool_input = block.get("input", {})
                        agent_logger.info(f"工具调用: {tool_name} | 输入: {json.dumps(tool_input, ensure_ascii=False)[:500]}")
                        print(f"[Agent] 工具调用: {tool_name}")
                        # Report tool usage to frontend
                        if tool_name == "Read":
                            file_path = tool_input.get("file_path", "")
                            short = file_path.split("/")[-1] if file_path else "文件"
                            _progress(f"正在读取源码: {short}")
                        elif tool_name == "Grep":
                            pattern = tool_input.get("pattern", "")
                            _progress(f"正在搜索代码: {pattern[:40]}")
                        elif tool_name == "Bash":
                            _progress("正在执行命令...")
                        elif "neo4j" in tool_name.lower():
                            _progress("正在查询知识图谱...")
                        else:
                            _progress(f"正在使用工具: {tool_name}")

                    elif block_type == "text":
                        text = block.get("text", "")
                        if text.strip():
                            agent_logger.debug(f"模型文本: {text[:300]}")

        # user 事件：解析工具返回结果
        elif event_type == "user":
            # 先记录原始结构用于调试
            agent_logger.debug(f"user 事件 keys={list(event.keys())}, message keys={list(message.keys()) if isinstance(message, dict) else 'N/A'}")

            # 方式1: tool_use_result 在事件顶层
            if "tool_use_result" in event:
                tool_result = event["tool_use_result"]
                agent_logger.debug(f"tool_use_result 类型={type(tool_result).__name__}, 值={str(tool_result)[:500]}")

                if isinstance(tool_result, dict):
                    tool_name = tool_result.get("name", "unknown")
                    # Read 工具返回 {"type":"text","file":{"filePath":"...","content":"..."}}
                    if "file" in tool_result and isinstance(tool_result["file"], dict):
                        file_info = tool_result["file"]
                        tool_name = "Read"
                        content = file_info.get("content", "")
                        agent_logger.info(f"读取文件: {file_info.get('filePath', '?')}")
                    # Bash 工具返回 {"stdout":"...","stderr":"..."}
                    elif "stdout" in tool_result:
                        tool_name = "Bash"
                        content = tool_result.get("stdout", "") + tool_result.get("stderr", "")
                    else:
                        content = str(tool_result.get("content", "") or tool_result.get("output", ""))
                elif isinstance(tool_result, str):
                    tool_name = "unknown"
                    content = tool_result
                elif isinstance(tool_result, list):
                    tool_name = "unknown"
                    parts = []
                    for item in tool_result:
                        if isinstance(item, dict) and item.get("type") == "text":
                            parts.append(item.get("text", ""))
                        elif isinstance(item, str):
                            parts.append(item)
                    content = "\n".join(parts)
                else:
                    tool_name = "unknown"
                    content = str(tool_result) if tool_result else ""

                agent_logger.info(f"工具结果: {tool_name} | 输出长度: {len(content)}")
                agent_logger.debug(f"工具结果详情: {tool_name} | {content[:1000]}")

            # 方式2: message.content 中的 tool_result 块
            elif isinstance(message, dict):
                content_blocks = message.get("content", [])
                if isinstance(content_blocks, list):
                    for block in content_blocks:
                        if not isinstance(block, dict):
                            continue
                        block_type = block.get("type", "")
                        if block_type == "tool_result":
                            tool_use_id = block.get("tool_use_id", "")
                            # content 可能是字符串或列表
                            raw_content = block.get("content", "")
                            if isinstance(raw_content, list):
                                # 提取 text 块拼接
                                parts = []
                                for item in raw_content:
                                    if isinstance(item, dict) and item.get("type") == "text":
                                        parts.append(item.get("text", ""))
                                content = "\n".join(parts)
                            else:
                                content = str(raw_content)
                            agent_logger.info(f"工具结果: tool_use_id={tool_use_id} | 输出长度: {len(content)}")
                            agent_logger.debug(f"工具结果详情: {content[:1000]}")

        # system 事件
        elif event_type == "system":
            if event_subtype == "init":
                model = event.get("model", "unknown")
                tools = event.get("tools", [])
                tool_names = [t.get("name", "") if isinstance(t, dict) else str(t) for t in tools] if isinstance(tools, list) else []
                agent_logger.info(f"会话初始化: model={model}, 可用工具={tool_names}")
            elif event_subtype == "task_started":
                desc = event.get("description", "")
                agent_logger.info(f"子任务启动: {desc}")

        elif event_type == "rate_limit_event":
            rate_info = event.get("rate_limit_info", {})
            agent_logger.warning(f"速率限制: {json.dumps(rate_info, ensure_ascii=False)[:300]}")

        elif event_type == "result":
            # 最终结果
            agent_text = str(event.get("result", ""))
            cost = event.get("cost_usd")
            duration_ms = event.get("duration_ms")
            if cost is not None:
                agent_logger.info(f"API 费用: ${cost:.4f}")
            if duration_ms is not None:
                agent_logger.info(f"API 内部耗时: {duration_ms}ms")

    if not agent_text:
        # 兜底：如果 stream-json 没有 result 事件，尝试从最后一行提取
        agent_logger.warning("未从 stream-json 中解析到 result 事件，尝试兜底解析")
        try:
            last_event = json.loads(raw_output.split("\n")[-1].strip())
            agent_text = str(last_event.get("result", raw_output))
        except json.JSONDecodeError:
            agent_text = raw_output

    print(f"[Agent] claude CLI 输出长度: {len(agent_text)}")

    agent_logger.info(f"模型输出长度: {len(agent_text)}")
    agent_logger.debug(f"模型输出内容:\n{agent_text}")
    print(f"[Agent] 模型输出前200字符: {agent_text[:200]}")

    # 6. 解析模型输出 → PageDiffResponse
    _progress("AI 分析完成，正在解析修改指令...")
    result = parse_agent_output(agent_text)

    t_end = time.time()
    total_duration = t_end - t_start
    agent_logger.info(f"完成: 插入={len(result['insert_blocks'])}, 删除={len(result['delete_blocks'])}, "
                      f"CLI耗时={cli_duration:.2f}s, 总耗时={total_duration:.2f}s")
    agent_logger.info("=" * 60)

    print(f"[Agent] 完成: 插入 {len(result['insert_blocks'])} 个, 删除 {len(result['delete_blocks'])} 个, 总耗时 {total_duration:.1f}s")
    return result
