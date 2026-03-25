"""
Wiki 交互式修改智能体

使用 Anthropic Claude API 的 tool use 模式，实现 agentic loop：
Claude 根据用户需求自主决定需要哪些数据源，收集信息后提交结构化修改。
"""

import os
import json
import subprocess
import re
import time
import logging
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

# ==================== System Prompt ====================

SYSTEM_PROMPT = """你是 Wiki 文档编辑器。用户选中了一些内容块并提出修改需求。

## 核心原则
- 禁止凭空编造内容。所有描述必须基于实际源码或 Neo4j 图谱数据
- 在输出修改前，你必须先通过工具查阅相关源码文件或 Neo4j 数据，确认事实后再撰写
- 如果工具不可用或查不到数据，只能基于用户提供的已有 block 内容进行润色改写，不得添加未经验证的技术细节
- source_ids 中填写的 ID 必须来自页面已有的源码引用，或者你通过工具确认存在的文件

## 工作流程
1. 阅读用户选中的内容和修改需求
2. 使用工具查阅源码或 Neo4j 获取准确信息（如果选中内容有 source_ids，优先读取对应源码）
3. 基于查到的事实数据输出修改指令
4. 对应源码在/Users/uinas/code/wiki-demo/wiki-demo/frontend/public/source-code/mall中
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

# ==================== 工具定义 ====================

TOOLS = [
    {
        "name": "read_source_file",
        "description": "读取项目源码文件。可以指定行范围只读取部分内容。",
        "input_schema": {
            "type": "object",
            "properties": {
                "file_path": {
                    "type": "string",
                    "description": "源码文件路径（相对于项目根目录）"
                },
                "start_line": {
                    "type": "integer",
                    "description": "起始行号（从1开始，含）"
                },
                "end_line": {
                    "type": "integer",
                    "description": "结束行号（从1开始，含）"
                }
            },
            "required": ["file_path"]
        }
    },
    {
        "name": "search_codebase",
        "description": "在代码库中搜索文本模式，返回匹配的文件和行号。",
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "搜索模式（支持正则表达式）"
                },
                "file_pattern": {
                    "type": "string",
                    "description": "文件过滤模式，例如 '*.java'"
                }
            },
            "required": ["query"]
        }
    },
    {
        "name": "read_wiki_page",
        "description": "读取其他 Wiki 页面的内容，了解相关模块的文档。",
        "input_schema": {
            "type": "object",
            "properties": {
                "page_path": {
                    "type": "string",
                    "description": "Wiki 页面路径"
                }
            },
            "required": ["page_path"]
        }
    },
    {
        "name": "query_neo4j",
        "description": "执行 Cypher 查询，从 Neo4j 知识图谱获取代码实体和关系信息。",
        "input_schema": {
            "type": "object",
            "properties": {
                "cypher_query": {
                    "type": "string",
                    "description": "Cypher 查询语句"
                }
            },
            "required": ["cypher_query"]
        }
    },
    {
        "name": "submit_page_diff",
        "description": "提交对当前 Wiki 页面的修改。收集完信息后调用此工具，会终止对话。",
        "input_schema": {
            "type": "object",
            "properties": {
                "insert_blocks": {
                    "type": "array",
                    "description": "要插入的 block 列表。each: {after_block: 目标block ID, block: 新block对象}",
                    "items": {
                        "type": "object",
                        "properties": {
                            "after_block": {"type": "string"},
                            "block": {"type": "object"}
                        },
                        "required": ["after_block", "block"]
                    }
                },
                "delete_blocks": {
                    "type": "array",
                    "description": "要删除的 block ID 列表",
                    "items": {"type": "string"}
                },
                "insert_sources": {
                    "type": "array",
                    "description": "要添加的源码引用",
                    "items": {
                        "type": "object",
                        "properties": {
                            "source_id": {"type": "string"},
                            "name": {"type": "string"},
                            "lines": {"type": "array", "items": {"type": "string"}}
                        },
                        "required": ["source_id", "name", "lines"]
                    }
                },
                "delete_sources": {
                    "type": "array",
                    "description": "要删除的源码引用 ID 列表",
                    "items": {"type": "string"}
                }
            }
        }
    },
    {
        "name": "submit_create_page",
        "description": "创建新的 Wiki 页面。当用户需求需要新建独立页面时调用，会终止对话。",
        "input_schema": {
            "type": "object",
            "properties": {
                "new_page_path": {
                    "type": "string",
                    "description": "新页面路径，例如 'module-name/page-name.json'"
                },
                "content": {
                    "type": "array",
                    "description": "页面内容 blocks（同 markdown_content 结构）"
                },
                "source": {
                    "type": "array",
                    "description": "页面源码引用列表",
                    "items": {
                        "type": "object",
                        "properties": {
                            "source_id": {"type": "string"},
                            "name": {"type": "string"},
                            "lines": {"type": "array", "items": {"type": "string"}}
                        },
                        "required": ["source_id", "name", "lines"]
                    }
                }
            },
            "required": ["new_page_path", "content", "source"]
        }
    }
]

# ==================== 工具执行 ====================


def _read_source_file(tool_input: dict) -> str:
    """读取源码文件"""
    file_path = tool_input["file_path"]
    source_root = SOURCE_ROOT_PATH

    if not source_root:
        return "错误：未配置 SOURCE_ROOT_PATH 环境变量，无法读取源码文件。"

    full_path = os.path.join(source_root, file_path)
    if not os.path.isfile(full_path):
        return f"文件不存在：{file_path}"

    try:
        with open(full_path, 'r', encoding='utf-8') as f:
            lines = f.readlines()
    except Exception as e:
        return f"读取文件失败：{e}"

    start = tool_input.get("start_line")
    end = tool_input.get("end_line")

    if start is not None or end is not None:
        start = max(1, start or 1)
        end = min(len(lines), end or len(lines))
        lines = lines[start - 1:end]
        header = f"文件：{file_path} (行 {start}-{end})\n"
    else:
        header = f"文件：{file_path} (共 {len(lines)} 行)\n"

    # 限制输出大小
    content = "".join(lines)
    if len(content) > 50000:
        content = content[:50000] + "\n... (内容已截断)"

    return header + content


def _search_codebase(tool_input: dict) -> str:
    """搜索代码库"""
    source_root = SOURCE_ROOT_PATH
    if not source_root:
        return "错误：未配置 SOURCE_ROOT_PATH 环境变量，无法搜索代码库。"

    query = tool_input["query"]
    file_pattern = tool_input.get("file_pattern")

    cmd = ["grep", "-rn", "--max-count=5", query, source_root]
    if file_pattern:
        cmd = ["grep", "-rn", "--max-count=5", "--include", file_pattern, query, source_root]

    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=30,
        )
        output = result.stdout.strip()
        if not output:
            return f"未找到匹配 '{query}' 的结果。"
        # 将绝对路径转为相对路径
        output = output.replace(source_root + "/", "")
        # 限制输出行数
        lines = output.split("\n")
        if len(lines) > 100:
            output = "\n".join(lines[:100]) + f"\n... (共 {len(lines)} 条结果，已截断)"
        return output
    except subprocess.TimeoutExpired:
        return "搜索超时（30秒）。请尝试更精确的搜索模式。"
    except Exception as e:
        return f"搜索失败：{e}"


def _read_wiki_page(tool_input: dict, wiki_root: str) -> str:
    """读取其他 Wiki 页面"""
    page_path = tool_input["page_path"].lstrip("/")
    if os.path.isabs(wiki_root):
        json_path = os.path.join(wiki_root, page_path)
    else:
        json_path = os.path.join(os.path.dirname(__file__), wiki_root, page_path)

    if not os.path.isfile(json_path):
        return f"Wiki 页面不存在：{page_path}"

    try:
        with open(json_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        content = json.dumps(data, ensure_ascii=False, indent=2)
        if len(content) > 50000:
            content = content[:50000] + "\n... (内容已截断)"
        return content
    except Exception as e:
        return f"读取 Wiki 页面失败：{e}"


def _query_neo4j(tool_input: dict) -> str:
    """查询 Neo4j"""
    neo4j_uri = os.environ.get("NEO4J_URI")
    if not neo4j_uri:
        return "Neo4j 未配置（缺少 NEO4J_URI 环境变量）。请使用其他工具获取代码关系信息。"

    try:
        from neo4j import GraphDatabase
        neo4j_user = os.environ.get("NEO4J_USER", "neo4j")
        neo4j_password = os.environ.get("NEO4J_PASSWORD", "")
        driver = GraphDatabase.driver(neo4j_uri, auth=(neo4j_user, neo4j_password))

        with driver.session() as session:
            result = session.run(tool_input["cypher_query"])
            records = [dict(record) for record in result]

        driver.close()

        if not records:
            return "查询无结果。"

        output = json.dumps(records, ensure_ascii=False, indent=2, default=str)
        if len(output) > 30000:
            output = output[:30000] + "\n... (结果已截断)"
        return output
    except ImportError:
        return "Neo4j 驱动未安装。请安装 neo4j 包或使用其他工具。"
    except Exception as e:
        return f"Neo4j 查询失败：{e}"


def execute_tool(tool_name: str, tool_input: dict, wiki_root: str) -> str:
    """工具分发器"""
    t = time.time()
    agent_logger.info(f"工具执行开始: {tool_name} | 输入: {json.dumps(tool_input, ensure_ascii=False)[:500]}")

    if tool_name == "read_source_file":
        result = _read_source_file(tool_input)
    elif tool_name == "search_codebase":
        result = _search_codebase(tool_input)
    elif tool_name == "read_wiki_page":
        result = _read_wiki_page(tool_input, wiki_root)
    elif tool_name == "query_neo4j":
        result = _query_neo4j(tool_input)
    else:
        result = f"未知工具：{tool_name}"

    duration = time.time() - t
    agent_logger.info(f"工具执行完成: {tool_name} | 耗时={duration:.2f}s | 输出长度={len(result)}")
    agent_logger.debug(f"工具输出: {tool_name} | {result[:1000]}")
    return result


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
) -> dict:
    """
    使用 Claude agentic loop 处理用户的详细查询请求。

    Returns:
        dict: PageDiffResponse 或 CreatePageResponse 格式的结果
    """
    t_start = time.time()
    agent_logger.info("=" * 60)
    agent_logger.info(f"新请求: page_path={page_path}, block_ids={block_ids}, user_query={user_query}")

    # 1. 加载当前页面（路径逻辑与 server.py 的 fetch_page 一致）
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
    selected_blocks = find_blocks_by_ids(page_content, set(block_ids))

    # 3. 构建页面结构概览
    outline = build_page_outline(page_content)

    # 4. 提取选中 blocks 的 markdown 和 source_id
    selected_parts = []
    for block in selected_blocks:
        bid = block.get("id", "?")
        md = extract_markdown(block)
        sids = extract_source_ids(block)
        selected_parts.append(f"[{bid}] (source_ids: {', '.join(sids) if sids else '无'})\n{md}")
    selected_text = "\n\n---\n\n".join(selected_parts)

    # 5. 构建精简 prompt
    prompt = f"""{SYSTEM_PROMPT}

## 页面结构概览
{outline}

## 用户选中的内容
{selected_text}

## 用户需求
{user_query}"""

    t_prompt_ready = time.time()
    agent_logger.info(f"Prompt 构建完成: 长度={len(prompt)}, 耗时={t_prompt_ready - t_start:.2f}s")
    print(f"[Agent] 调用 claude CLI (model={CLAUDE_MODEL}), prompt长度={len(prompt)}")

    t_cli_start = time.time()
    try:
        cli_result = subprocess.run(
            ["claude", "-p", prompt, "--model", CLAUDE_MODEL, "--output-format", "stream-json",
             "--verbose"],
            capture_output=True,
            text=True,
            timeout=120,
            cwd=SOURCE_ROOT_PATH or None,
        )
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
    result = parse_agent_output(agent_text)

    t_end = time.time()
    total_duration = t_end - t_start
    agent_logger.info(f"完成: 插入={len(result['insert_blocks'])}, 删除={len(result['delete_blocks'])}, "
                      f"CLI耗时={cli_duration:.2f}s, 总耗时={total_duration:.2f}s")
    agent_logger.info("=" * 60)

    print(f"[Agent] 完成: 插入 {len(result['insert_blocks'])} 个, 删除 {len(result['delete_blocks'])} 个, 总耗时 {total_duration:.1f}s")
    return result
