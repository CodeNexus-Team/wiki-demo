"""
Wiki Reader MCP Server

提供 wiki 目录的只读访问工具，供 Claude CLI 通过 MCP 协议调用。
相比直接暴露原生 Read 工具，本 server 有三个优点：
  1. 只读 + path traversal 防护：wiki_root 之外的路径一律拒绝
  2. 返回精简视图：去掉 neo4j_id/neo4j_source 等元数据，节省 token
  3. 业务语义工具：按段读取、只取大纲、前缀过滤等

通信方式：通过环境变量 WIKI_ROOT_PATH 告诉 MCP server wiki 目录绝对路径。
"""

import os
import json
import logging
from pathlib import Path
from mcp.server.fastmcp import FastMCP

# 日志
LOG_DIR = os.path.join(os.path.dirname(__file__), "logs")
os.makedirs(LOG_DIR, exist_ok=True)
logger = logging.getLogger("wiki_reader_mcp")
logger.setLevel(logging.DEBUG)
_handler = logging.FileHandler(os.path.join(LOG_DIR, "wiki_reader_mcp.log"), encoding="utf-8")
_handler.setFormatter(logging.Formatter("%(asctime)s [%(levelname)s] %(message)s"))
logger.addHandler(_handler)

WIKI_ROOT = os.environ.get("WIKI_ROOT_PATH", "")
if not WIKI_ROOT:
    logger.warning("WIKI_ROOT_PATH 环境变量未设置，wiki-reader 将无法工作")

mcp = FastMCP("wiki-reader")


# ==================== 路径安全 ====================


def _safe_resolve(rel_path: str) -> Path | None:
    """
    把相对路径解析为 wiki_root 下的绝对路径，防止 path traversal。
    不合法（越界、不存在、非 JSON）时返回 None。
    """
    if not WIKI_ROOT:
        return None
    try:
        root = Path(WIKI_ROOT).resolve()
        # 去掉开头的 / 避免被当成绝对路径
        rel = rel_path.lstrip("/\\")
        target = (root / rel).resolve()
        # 严格确保 target 在 root 之下
        target.relative_to(root)
        return target
    except (ValueError, OSError) as e:
        logger.warning(f"路径解析失败: {rel_path} — {e}")
        return None


# ==================== Block 精简 ====================


def _simplify_block(block: dict) -> dict:
    """
    递归精简 block：保留对模型有用的字段，去掉 neo4j_id/neo4j_source/_meta 等噪声。
    """
    if not isinstance(block, dict):
        return block

    keep = {}
    for key in ("id", "type", "title", "source_id"):
        if key in block:
            keep[key] = block[key]

    content = block.get("content")
    if isinstance(content, dict):
        # text / mermaid 等叶子 block，content 是 dict
        kept_content = {}
        for k in ("markdown", "mermaid"):
            if k in content:
                kept_content[k] = content[k]
        keep["content"] = kept_content
    elif isinstance(content, list):
        # section 等容器 block，content 是 list[block]
        keep["content"] = [_simplify_block(c) for c in content if isinstance(c, dict)]

    return keep


def _extract_outline(blocks: list, depth: int = 0, lines: list | None = None) -> list:
    """生成缩进大纲：只保留 section 标题和 text 前 60 字预览"""
    if lines is None:
        lines = []
    for block in blocks:
        if not isinstance(block, dict):
            continue
        indent = "  " * depth
        block_id = block.get("id", "?")
        if block.get("type") == "section":
            title = block.get("title", "(无标题)")
            lines.append(f"{indent}- [{block_id}] {title}")
            children = block.get("content")
            if isinstance(children, list):
                _extract_outline(children, depth + 1, lines)
        else:
            content = block.get("content")
            md = content.get("markdown", "") if isinstance(content, dict) else ""
            preview = md[:60].replace("\n", " ")
            if len(md) > 60:
                preview += "..."
            lines.append(f"{indent}- [{block_id}] text: {preview}")
    return lines


def _find_section_by_id(blocks: list, target_id: str) -> dict | None:
    """递归查找指定 id 的 block"""
    for block in blocks:
        if not isinstance(block, dict):
            continue
        if block.get("id") == target_id:
            return block
        children = block.get("content")
        if isinstance(children, list):
            found = _find_section_by_id(children, target_id)
            if found:
                return found
    return None


# ==================== 工具 ====================


@mcp.tool()
def read_wiki_page(path: str) -> str:
    """读取 wiki 页面的精简内容，返回 JSON 字符串。

    相比直接 Read 原始 JSON 文件，此工具已去除 neo4j_id/neo4j_source 等元数据，
    只保留对阅读有意义的 id / type / title / content.markdown / source_id 字段，
    显著节省 token。

    Args:
        path: wiki 页面相对路径（相对于 wiki 根目录），例如 "门户系统/订单管理.json"

    Returns:
        精简后的 block 树 JSON。如果页面不存在或路径非法，返回错误说明。
    """
    logger.info(f"read_wiki_page: path={path}")

    target = _safe_resolve(path)
    if target is None:
        return f"错误：路径 {path!r} 不合法或 wiki_root 未配置。"
    if not target.is_file():
        return f"错误：文件 {path!r} 不存在。"
    if target.suffix.lower() != ".json":
        return f"错误：只能读取 .json 文件，当前 {target.suffix!r}。"

    try:
        with open(target, "r", encoding="utf-8") as f:
            data = json.load(f)
    except (json.JSONDecodeError, OSError) as e:
        logger.error(f"读取 {path} 失败: {e}")
        return f"读取文件失败：{e}"

    blocks = data.get("markdown_content", [])
    simplified = [_simplify_block(b) for b in blocks if isinstance(b, dict)]

    result = json.dumps(
        {"path": path, "markdown_content": simplified},
        ensure_ascii=False,
        indent=2,
    )

    # 截断上限 20KB:保留余量给外层 stream-json 的 JSON escape(换行/引号/反斜杠 escape 会让体积膨胀 30%+),
    # 避免单个 tool_use_result 事件超过 asyncio subprocess StreamReader 的单行上限。
    if len(result) > 20000:
        result = result[:20000] + "\n... (内容已截断，请用 get_page_outline 查看完整结构，再用 read_wiki_section 读具体段落)"

    logger.info(f"read_wiki_page: 返回 {len(result)} 字符")
    return result


@mcp.tool()
def get_page_outline(path: str) -> str:
    """只返回 wiki 页面的大纲（section 树 + block 预览），不返回完整 markdown 正文。

    当你只想快速了解某页的结构、或需要定位某个 block id 时使用此工具。
    比 read_wiki_page 更省 token，适合跨页探索阶段。

    Args:
        path: wiki 页面相对路径，例如 "门户系统/订单管理.json"
    """
    logger.info(f"get_page_outline: path={path}")

    target = _safe_resolve(path)
    if target is None:
        return f"错误：路径 {path!r} 不合法或 wiki_root 未配置。"
    if not target.is_file():
        return f"错误：文件 {path!r} 不存在。"

    try:
        with open(target, "r", encoding="utf-8") as f:
            data = json.load(f)
    except (json.JSONDecodeError, OSError) as e:
        return f"读取文件失败：{e}"

    blocks = data.get("markdown_content", [])
    lines = _extract_outline(blocks)

    return f"# {path} 大纲\n\n" + "\n".join(lines)


@mcp.tool()
def read_wiki_section(path: str, section_id: str) -> str:
    """读取 wiki 页面中某个指定 block（及其所有子 block）的精简内容。

    当 read_wiki_page 返回的内容过长被截断时，用此工具按 id 精准读取某段。
    先用 get_page_outline 找到目标 block id，再调用此工具。

    Args:
        path: wiki 页面相对路径
        section_id: 目标 block 的 id（可以是 section 或 text block）
    """
    logger.info(f"read_wiki_section: path={path}, section_id={section_id}")

    target = _safe_resolve(path)
    if target is None:
        return f"错误：路径 {path!r} 不合法或 wiki_root 未配置。"
    if not target.is_file():
        return f"错误：文件 {path!r} 不存在。"

    try:
        with open(target, "r", encoding="utf-8") as f:
            data = json.load(f)
    except (json.JSONDecodeError, OSError) as e:
        return f"读取文件失败：{e}"

    blocks = data.get("markdown_content", [])
    found = _find_section_by_id(blocks, section_id)
    if found is None:
        return f"错误：在 {path} 中未找到 id={section_id!r} 的 block。"

    simplified = _simplify_block(found)
    return json.dumps(simplified, ensure_ascii=False, indent=2)


@mcp.tool()
def list_wiki_pages(prefix: str = "") -> str:
    """列出 wiki 目录下所有页面的相对路径。

    Args:
        prefix: 可选的路径前缀过滤，例如 "门户系统/" 只返回该目录下的页面。
                空字符串表示返回全部页面。
    """
    logger.info(f"list_wiki_pages: prefix={prefix!r}")

    if not WIKI_ROOT:
        return "错误：WIKI_ROOT_PATH 未配置。"

    root = Path(WIKI_ROOT).resolve()
    if not root.is_dir():
        return f"错误：wiki 根目录 {root} 不存在或不是目录。"

    results = []
    for json_file in root.rglob("*.json"):
        # 跳过隐藏目录（.index、.meta 等）
        try:
            rel = json_file.relative_to(root)
        except ValueError:
            continue
        if any(part.startswith(".") for part in rel.parts):
            continue
        if json_file.name == "root_doc.json":
            continue
        rel_str = str(rel).replace(os.sep, "/")
        if prefix and not rel_str.startswith(prefix):
            continue
        results.append(rel_str)

    results.sort()
    if not results:
        return f"(前缀 {prefix!r} 下无匹配页面)"
    return "\n".join(results)


if __name__ == "__main__":
    mcp.run()
