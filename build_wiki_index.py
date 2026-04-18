#!/usr/bin/env python3
"""
Wiki Index Builder (OpenAI-powered)

为整个 wiki_result 目录生成 wiki_index.json，供 LLM 快速了解整体情况、定位用户需求。

粒度：页面级 + outline（每页一条 entry，附带 H2 章节标题列表）

两阶段流程：
1. 逐页 LLM 提取（并发）：调用 OpenAI API 生成精准 summary 和意图关键词
   - 增量更新：检查 mtime，未变化的页面跳过，复用 .meta 缓存
2. 全局聚合：读取所有单页 meta，生成 wiki_index.json
   - 跨页交叉引用（同一类/源文件出现在哪些页面）
   - 全局统计

环境变量：
    OPENAI_API_KEY    OpenAI API Key（必须，使用 LLM 模式时）
    OPENAI_MODEL      模型名（默认 gpt-4o-mini）
    OPENAI_BASE_URL   可选，第三方兼容服务地址（如 Azure / 国内代理）

Usage:
    python build_wiki_index.py /path/to/wiki_result
    python build_wiki_index.py /path/to/wiki_result --force          # 忽略缓存全量重建
    python build_wiki_index.py /path/to/wiki_result --concurrency 10 # LLM 并发数（OpenAI 可以更高）
    python build_wiki_index.py /path/to/wiki_result --no-llm         # 纯规则模式（无需 API key）
"""

import os
import sys
import json
import re
import argparse
import asyncio
import time
import hashlib
from pathlib import Path

# 加载 .env 中的 OPENAI_API_KEY 等变量（如果存在）
try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).parent / "server" / ".env")
    load_dotenv(Path(__file__).parent / ".env")
except ImportError:
    pass


# ==================== 基础解析（无 LLM）====================


def _walk_blocks(blocks: list, callback):
    for b in blocks:
        if not isinstance(b, dict):
            continue
        callback(b)
        children = b.get("content")
        if isinstance(children, list):
            _walk_blocks(children, callback)


def _extract_text(block: dict) -> str:
    if block.get("type") != "text":
        return ""
    content = block.get("content")
    if isinstance(content, dict):
        return content.get("markdown") or ""
    return ""


def _strip_markdown(text: str) -> str:
    text = re.sub(r"```[\s\S]*?```", "", text)
    text = re.sub(r"`[^`]+`", "", text)
    text = re.sub(r"!?\[([^\]]*)\]\([^\)]*\)", r"\1", text)
    text = re.sub(r"[*_#>\-|]+", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def _extract_outline(blocks: list, max_depth: int = 2) -> list:
    """提取顶层 section 标题作为 outline（H2/H3）"""
    titles = []

    def visit(b: dict, depth: int = 0):
        if b.get("type") == "section":
            title = b.get("title", "")
            cleaned = re.sub(r"^#+\s*", "", title).strip()
            if cleaned and depth >= 1 and depth <= max_depth:
                titles.append({"id": b.get("id"), "title": cleaned, "level": depth + 1})
            children = b.get("content")
            if isinstance(children, list):
                for c in children:
                    if isinstance(c, dict):
                        visit(c, depth + 1)

    for b in blocks:
        if isinstance(b, dict):
            visit(b)
    return titles


def _extract_neo4j_names(blocks: list) -> set:
    names: set = set()

    def collect(b: dict):
        ns = b.get("neo4j_source")
        if isinstance(ns, dict):
            for v in ns.values():
                if isinstance(v, list):
                    for item in v:
                        if isinstance(item, str) and item:
                            names.add(item)
                elif isinstance(v, str) and v:
                    names.add(v)

    _walk_blocks(blocks, collect)
    return names


def _filter_class_names(names: set) -> list:
    result = []
    for n in names:
        if "/" in n or "." in n:
            continue
        if len(n) >= 3 and n[0].isupper() and any(c.islower() for c in n):
            result.append(n)
    return sorted(set(result))


def _has_mermaid(blocks: list) -> bool:
    found = [False]

    def check(b: dict):
        content = b.get("content")
        if isinstance(content, dict) and content.get("mermaid"):
            found[0] = True

    _walk_blocks(blocks, check)
    return found[0]


def _count_blocks(blocks: list) -> int:
    count = [0]
    _walk_blocks(blocks, lambda b: count.__setitem__(0, count[0] + 1))
    return count[0]


def _collect_full_text(blocks: list, max_chars: int = 8000) -> str:
    """收集页面所有 text block 的纯文本内容（用作 LLM 输入）"""
    texts = []
    total = 0

    def collect(b: dict):
        nonlocal total
        if total >= max_chars:
            return
        if b.get("type") == "section":
            title = b.get("title", "")
            cleaned = re.sub(r"^#+\s*", "", title).strip()
            if cleaned:
                texts.append(f"\n## {cleaned}")
                total += len(cleaned) + 4
            return
        text = _extract_text(b)
        if text:
            cleaned = _strip_markdown(text)
            if cleaned:
                texts.append(cleaned)
                total += len(cleaned)

    _walk_blocks(blocks, collect)

    full = "\n".join(texts)
    if len(full) > max_chars:
        full = full[:max_chars].rstrip() + "..."
    return full


def _fallback_summary(blocks: list, max_chars: int = 200) -> str:
    """LLM 失败时的回退摘要：取前几个 text block"""
    texts = []
    total = 0

    def collect(b: dict):
        nonlocal total
        if total >= max_chars:
            return
        text = _extract_text(b)
        if text:
            cleaned = _strip_markdown(text)
            if cleaned:
                texts.append(cleaned)
                total += len(cleaned)

    _walk_blocks(blocks, collect)
    summary = " ".join(texts)
    if len(summary) > max_chars:
        summary = summary[:max_chars].rstrip() + "..."
    return summary


# ==================== LLM 提取（OpenAI API）====================

# 配置（支持环境变量覆盖）
OPENAI_MODEL = os.environ.get("OPENAI_MODEL", "gpt-4o-mini")  # 默认用便宜快速的 mini
OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY")
OPENAI_BASE_URL = os.environ.get("OPENAI_BASE_URL")  # 可选：用于第三方兼容服务
# Reasoning 模型（o1、o3、gpt-5 等）会先思考再输出，需要更大的 token 预算
REASONING_MODEL_PREFIXES = ("o1", "o3", "o4", "gpt-5", "deepseek-r")


def _is_reasoning_model(model: str) -> bool:
    name = model.lower()
    return any(name.startswith(p) for p in REASONING_MODEL_PREFIXES)

# 全局 client，惰性初始化
_openai_client = None


def _get_openai_client():
    global _openai_client
    if _openai_client is None:
        try:
            from openai import AsyncOpenAI
        except ImportError:
            raise RuntimeError("openai 包未安装，请运行: pip install openai")

        if not OPENAI_API_KEY:
            raise RuntimeError("未配置 OPENAI_API_KEY 环境变量")

        kwargs = {"api_key": OPENAI_API_KEY}
        if OPENAI_BASE_URL:
            kwargs["base_url"] = OPENAI_BASE_URL
        _openai_client = AsyncOpenAI(**kwargs)
    return _openai_client


LLM_SYSTEM_PROMPT = """你是一个文档索引助手，为 Wiki 页面生成简洁的摘要、关键词和推荐问题。
严格以 JSON 格式输出，不要任何额外文字或 markdown 包裹。"""

LLM_USER_PROMPT_TEMPLATE = """请为下面这个 Wiki 页面生成索引信息。

输出严格的 JSON：
{{
  "summary": "用 50~100 字概括此页面在讲什么（核心模块/职责/主要功能）",
  "intent_keywords": ["关键词1", "关键词2", "..."],
  "suggested_questions": ["问题1", "问题2", "问题3"]
}}

要求：
- summary 中文，不超过 100 字，直接陈述事实，不要"本页介绍..."这种套话
- intent_keywords 列出 4~8 个用户可能用来询问此页面的关键词或问题方向（中文，每个 2~10 字）
- 关键词应覆盖：核心类名/概念、业务功能点、技术细节、跨模块关系
- 不要重复 outline 中已有的内容
- suggested_questions 列出 3~5 个用户最可能问的具体问题（完整问句，每个 10~30 字）
  - 问题应当具体且有价值，能引导深入理解此页面
  - 例如："订单状态是怎么流转的？"、"JWT 过期后如何刷新？"、"商品搜索用了什么算法？"
  - 不要泛泛而谈，避免"这是什么？"、"有哪些功能？"等空洞问题
  - 不要重复 summary 已经回答的内容

页面标题：{title}

页面 Outline（章节列表）：
{outline_text}

页面内容：
{content}
"""


async def _call_llm(title: str, outline: list, content: str) -> dict:
    """调用 OpenAI API 提取 summary 和 intent_keywords"""
    client = _get_openai_client()
    outline_text = "\n".join(f"- {o['title']}" for o in outline) if outline else "(无)"
    user_prompt = LLM_USER_PROMPT_TEMPLATE.format(
        title=title,
        outline_text=outline_text,
        content=content,
    )

    # 是否支持 response_format（部分代理 / 旧模型不支持）
    use_json_mode = os.environ.get("OPENAI_NO_JSON_MODE", "").lower() not in ("1", "true", "yes")
    is_reasoning = _is_reasoning_model(OPENAI_MODEL)

    try:
        kwargs = {
            "model": OPENAI_MODEL,
            "messages": [
                {"role": "system", "content": LLM_SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
        }

        # 读 OPENAI_MAX_TOKENS 容错空字符串 (用户通过前端保存 .env 时可能写入空值)
        def _env_int(name: str, default: int) -> int:
            raw = (os.environ.get(name, "") or "").strip()
            if not raw:
                return default
            try:
                return int(raw)
            except ValueError:
                return default

        # Reasoning 模型（o1/o3/gpt-5 等）需要更大的 token 预算且使用新参数名
        if is_reasoning:
            # 思考 + 输出，预算给 4000；reasoning 模型不支持 temperature/top_p 等参数
            kwargs["max_completion_tokens"] = _env_int("OPENAI_MAX_TOKENS", 4000)
        else:
            kwargs["max_tokens"] = _env_int("OPENAI_MAX_TOKENS", 600)
            kwargs["temperature"] = 0.3

        if use_json_mode:
            kwargs["response_format"] = {"type": "json_object"}

        response = await asyncio.wait_for(
            client.chat.completions.create(**kwargs),
            timeout=120 if is_reasoning else 60,
        )
    except asyncio.TimeoutError:
        raise RuntimeError("LLM 调用超时")
    except Exception as e:
        raise RuntimeError(f"OpenAI API 调用失败: {type(e).__name__}: {e}")

    # 详细记录响应结构以便定位问题
    if not response.choices:
        raise RuntimeError(f"OpenAI 响应无 choices: {response}")

    choice = response.choices[0]
    finish_reason = getattr(choice, "finish_reason", "unknown")
    raw_content = choice.message.content

    if raw_content is None:
        raise RuntimeError(
            f"OpenAI 返回空内容（finish_reason={finish_reason}）。"
            f"可能原因：模型拒绝、内容被过滤、token 限制。完整 message: {choice.message}"
        )

    result_text = raw_content.strip()

    if not result_text:
        raise RuntimeError(
            f"OpenAI 返回空字符串（finish_reason={finish_reason}）。"
            f"完整响应: choices[0]={choice}"
        )

    # 容错：去除可能的 markdown 包裹（部分模型即使要求 json 也会包）
    result_text = re.sub(r"^```(?:json)?\s*", "", result_text)
    result_text = re.sub(r"\s*```$", "", result_text)

    json_match = re.search(r"\{[\s\S]*\}", result_text)
    if not json_match:
        raise RuntimeError(
            f"LLM 输出无法解析为 JSON（finish_reason={finish_reason}, 长度={len(result_text)}）。"
            f"原始内容: {repr(result_text[:500])}"
        )

    try:
        parsed = json.loads(json_match.group(0))
    except json.JSONDecodeError as e:
        raise RuntimeError(
            f"JSON 解析失败: {e}。原始内容: {repr(json_match.group(0)[:500])}"
        )

    return {
        "summary": str(parsed.get("summary", "")).strip(),
        "intent_keywords": [str(k).strip() for k in parsed.get("intent_keywords", []) if k],
        "suggested_questions": [str(q).strip() for q in parsed.get("suggested_questions", []) if q],
    }


# ==================== 单页 meta 提取 ====================


def extract_page_meta_basic(json_path: Path, page_path_rel: str) -> dict:
    """提取不依赖 LLM 的基础元信息"""
    with open(json_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    blocks = data.get("markdown_content", [])
    source_files = data.get("source_id", [])

    title = ""
    if blocks and isinstance(blocks[0], dict):
        raw_title = blocks[0].get("title", "")
        title = re.sub(r"^#+\s*", "", raw_title).strip()
    if not title:
        title = Path(page_path_rel).stem

    unique_files = sorted({s.get("name", "") for s in source_files if isinstance(s, dict) and s.get("name")})
    neo4j_names = _extract_neo4j_names(blocks)
    key_classes = _filter_class_names(neo4j_names)
    outline = _extract_outline(blocks, max_depth=2)

    return {
        "page_path": page_path_rel,
        "title": title,
        "outline": outline,
        "key_classes": key_classes[:30],
        "block_count": _count_blocks(blocks),
        "source_files": unique_files,
        "source_file_count": len(unique_files),
        "has_mermaid": _has_mermaid(blocks),
        "_blocks": blocks,  # 临时字段，给 LLM 用
        "_mtime": json_path.stat().st_mtime,
    }


async def enrich_with_llm(meta: dict) -> dict:
    """用 LLM 补充 summary、intent_keywords 和 suggested_questions"""
    blocks = meta.pop("_blocks", [])
    content = _collect_full_text(blocks, max_chars=8000)

    try:
        llm_result = await _call_llm(meta["title"], meta["outline"], content)
        meta["summary"] = llm_result["summary"] or _fallback_summary(blocks)
        meta["intent_keywords"] = llm_result["intent_keywords"]
        meta["suggested_questions"] = llm_result["suggested_questions"]
    except Exception as e:
        print(f"  ⚠ LLM 提取失败 ({meta['page_path']}): {e}", file=sys.stderr)
        meta["summary"] = _fallback_summary(blocks)
        meta["intent_keywords"] = []
        meta["suggested_questions"] = []

    # 清理仅 LLM 调用过程需要的中间字段，避免缓存文件臃肿
    # 保留 key_classes（真实类名，用于 index 的精确匹配路由）
    for k in ("outline", "block_count", "source_files",
              "source_file_count", "has_mermaid"):
        meta.pop(k, None)
    return meta


def fill_basic_summary(meta: dict) -> dict:
    """无 LLM 模式下的回退摘要"""
    blocks = meta.pop("_blocks", [])
    meta["summary"] = _fallback_summary(blocks)
    meta["intent_keywords"] = []
    meta["suggested_questions"] = []
    # 清理中间字段（保留 key_classes）
    for k in ("outline", "block_count", "source_files",
              "source_file_count", "has_mermaid"):
        meta.pop(k, None)
    return meta


# ==================== 缓存管理 ====================


def _meta_cache_path(meta_dir: Path, page_path_rel: str) -> Path:
    # 用 hash 避免长路径名超过文件系统限制
    digest = hashlib.md5(page_path_rel.encode("utf-8")).hexdigest()[:16]
    return meta_dir / f"{digest}.meta.json"


def _load_cached_meta(meta_dir: Path, page_path_rel: str, json_path: Path):
    cache_path = _meta_cache_path(meta_dir, page_path_rel)
    if not cache_path.exists():
        return None
    try:
        with open(cache_path, "r", encoding="utf-8") as f:
            cached = json.load(f)
        if cached.get("_mtime") == json_path.stat().st_mtime:
            return cached
    except (json.JSONDecodeError, IOError):
        return None
    return None


def _save_cached_meta(meta_dir: Path, page_path_rel: str, meta: dict):
    cache_path = _meta_cache_path(meta_dir, page_path_rel)
    cache_path.parent.mkdir(parents=True, exist_ok=True)
    with open(cache_path, "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)


# ==================== 阶段 1：并发逐页提取 ====================


async def extract_all_pages(
    wiki_root: Path,
    use_llm: bool = True,
    concurrency: int = 10,
    force: bool = False,
    on_progress=None,
):
    index_dir = wiki_root / ".index"
    index_dir.mkdir(exist_ok=True)
    meta_dir = index_dir / "meta"
    meta_dir.mkdir(exist_ok=True)

    all_files = []
    for f in wiki_root.rglob("*.json"):
        if index_dir in f.parents:
            continue
        if f.name == "root_doc.json":
            continue
        all_files.append(f)

    total = len(all_files)
    semaphore = asyncio.Semaphore(concurrency)

    async def process_one(idx: int, json_path: Path) -> dict:
        page_path_rel = str(json_path.relative_to(wiki_root))

        # 缓存命中
        if not force:
            cached = _load_cached_meta(meta_dir, page_path_rel, json_path)
            if cached is not None:
                if on_progress:
                    on_progress(idx + 1, total, page_path_rel, "cached")
                return cached

        meta = extract_page_meta_basic(json_path, page_path_rel)

        if use_llm:
            async with semaphore:
                if on_progress:
                    on_progress(idx + 1, total, page_path_rel, "llm")
                meta = await enrich_with_llm(meta)
        else:
            meta = fill_basic_summary(meta)
            if on_progress:
                on_progress(idx + 1, total, page_path_rel, "basic")

        _save_cached_meta(meta_dir, page_path_rel, meta)
        return meta

    tasks = [process_one(i, p) for i, p in enumerate(all_files)]
    results = await asyncio.gather(*tasks)
    results.sort(key=lambda m: m.get("page_path", ""))
    return results


# ==================== 阶段 2：全局聚合 ====================


def aggregate_index(page_metas: list) -> dict:
    """
    极简版 index：只保留 LLM 路由所需的最小字段。

    设计原则：
    - Claude CLI 能 Read 实际页面文件，index 只负责「路由」，不承担展示
    - title 可从 path basename 推导，不存
    - keywords（LLM 生成的业务关键词）与 summary 重叠，不存
    - questions 给前端推荐问题用，前端已改版，不存
    - 保留 classes：从 neo4j_source 提取的真实类名，用于精确类名查询路由

    每页字段：
      - path    (必需，Read 参数)
      - summary (必需，语义路由)
      - classes (可选，类名精确匹配，仅页面中实际出现的类)
    """
    pages_clean = []
    for meta in page_metas:
        page = {
            "path": meta.get("page_path", ""),
            "summary": meta.get("summary", ""),
        }
        classes = meta.get("key_classes", [])
        if classes:
            page["classes"] = classes
        pages_clean.append(page)

    return {
        "pages": pages_clean,
    }


# ==================== 主入口 ====================


async def build_index(
    wiki_root: Path,
    use_llm: bool = True,
    concurrency: int = 10,
    force: bool = False,
    verbose: bool = True,
) -> dict:
    t_start = time.time()

    def progress(current, total, page_path, mode):
        if verbose:
            tag = {"cached": "✓ cached", "llm": "→ llm", "basic": "→ basic"}.get(mode, mode)
            print(f"  [{current}/{total}] {tag}  {page_path}")

    if verbose:
        mode_label = f"LLM (并发 {concurrency})" if use_llm else "纯规则"
        print(f"阶段 1: 提取页面 meta（{mode_label}）...")

    page_metas = await extract_all_pages(
        wiki_root,
        use_llm=use_llm,
        concurrency=concurrency,
        force=force,
        on_progress=progress,
    )

    if verbose:
        print(f"阶段 2: 聚合 wiki_index.json...")
    index = aggregate_index(page_metas)

    # 输出到隐藏目录 .index/，避免被 wiki 扫描器扫到
    index_dir = wiki_root / ".index"
    index_dir.mkdir(exist_ok=True)
    output_path = index_dir / "wiki_index.json"
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(index, f, ensure_ascii=False, indent=2)

    elapsed = time.time() - t_start
    if verbose:
        file_size_kb = output_path.stat().st_size / 1024
        print(f"✓ wiki_index.json 已生成: {output_path}")
        print(f"  总页数: {len(index['pages'])}")
        print(f"  文件大小: {file_size_kb:.1f} KB")
        print(f"  耗时: {elapsed:.1f}s")

    return index


def main():
    parser = argparse.ArgumentParser(description="Build wiki_index.json for a wiki_result directory")
    parser.add_argument("wiki_root", help="Path to wiki_result directory")
    parser.add_argument("--force", action="store_true", help="Force rebuild, ignore cache")
    parser.add_argument("--no-llm", action="store_true", help="Skip LLM enrichment, use rule-based summary only")
    parser.add_argument("--concurrency", type=int, default=10, help="LLM concurrent calls (default: 10)")
    parser.add_argument("--quiet", action="store_true", help="Suppress progress output")
    args = parser.parse_args()

    wiki_root = Path(args.wiki_root).resolve()
    if not wiki_root.exists() or not wiki_root.is_dir():
        print(f"Error: {wiki_root} is not a valid directory")
        sys.exit(1)

    asyncio.run(build_index(
        wiki_root,
        use_llm=not args.no_llm,
        concurrency=args.concurrency,
        force=args.force,
        verbose=not args.quiet,
    ))


if __name__ == "__main__":
    main()
