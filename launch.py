#!/usr/bin/env python3
"""
Launch the wiki demo backend (used by the frontend "启动后端" button via Vite plugin).

与 demo.py 的区别:
  - demo.py: 命令行工具,由用户显式控制是否转换/建索引
  - launch.py: 前端一键启动用,自动做一致性检查决定是否转换/建索引,然后启动 uvicorn

流程:
  1. 检查 `<root>/wiki_result/.index/wiki_index.json` 是否存在
  2. 如果存在且 index 里的 pages 列表 == wiki_result/ 下 .json 实际列表 → 跳过转换和建索引
  3. 否则 → 跑 MarkdownToJsonParser + build_index
  4. 启动 uvicorn 监听 :11219

Usage:
    python launch.py <root_path> [--port 11219] [--force]
"""

import argparse
import asyncio
import json
import os
import sys
from pathlib import Path


def scan_wiki_result_paths(wiki_result_dir: Path) -> set:
    """扫描 wiki_result 下所有 .json 的相对路径(排除隐藏目录)"""
    paths = set()
    if not wiki_result_dir.is_dir():
        return paths
    for root, dirs, files in os.walk(wiki_result_dir):
        dirs[:] = [d for d in dirs if not d.startswith(".")]
        for f in files:
            if not f.endswith(".json") or f.startswith("."):
                continue
            rel = os.path.relpath(os.path.join(root, f), wiki_result_dir).replace(os.sep, "/")
            paths.add(rel)
    return paths


def is_build_consistent(wiki_result_dir: Path) -> bool:
    """检查 .index/wiki_index.json 是否存在且和 wiki_result 下的 .json 列表完全一致"""
    index_path = wiki_result_dir / ".index" / "wiki_index.json"
    if not index_path.is_file():
        return False
    try:
        with open(index_path, "r", encoding="utf-8") as f:
            index = json.load(f)
    except Exception:
        return False
    indexed = {p.get("path", "") for p in index.get("pages", []) if p.get("path")}
    actual = scan_wiki_result_paths(wiki_result_dir)
    return bool(indexed) and indexed == actual


def convert_raw_to_wiki_result(root_path: Path) -> dict:
    """用 MarkdownToJsonParser 把 .md / .meta.json 转换为 root_path/wiki_result/*.json"""
    from markdown_parser import MarkdownToJsonParser

    result_dir = root_path / "wiki_result"
    result_dir.mkdir(exist_ok=True)

    supported = []
    for pattern in ("*.md", "*.meta.json"):
        for fp in root_path.rglob(pattern):
            if result_dir in fp.parents or fp.parent == result_dir:
                continue
            supported.append(fp)

    parser_obj = MarkdownToJsonParser()
    converted = 0
    try:
        for input_file in supported:
            rel = input_file.relative_to(root_path)
            is_meta = input_file.name.endswith(".meta.json")
            if is_meta:
                out_name = input_file.name[:-len(".meta.json")] + ".json"
                out_file = result_dir / rel.parent / out_name
            else:
                out_file = result_dir / rel.with_suffix(".json")
            out_file.parent.mkdir(parents=True, exist_ok=True)

            print(f"[convert] {input_file.name}", flush=True)
            with open(input_file, "r", encoding="utf-8") as f:
                content = f.read()
            if is_meta:
                data = parser_obj.parse_json(json.loads(content), str(input_file))
            else:
                data = parser_obj.parse(content, str(input_file))
            with open(out_file, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=4, ensure_ascii=False)
            converted += 1
    finally:
        try:
            parser_obj.close()
        except Exception:
            pass

    return {"converted": converted, "scanned": len(supported)}


def main():
    parser = argparse.ArgumentParser(description="Launch wiki backend with auto build detection")
    parser.add_argument("root_path", help="Raw wiki root directory (contains .meta.json / .md files)")
    parser.add_argument("--port", type=int, default=11219, help="Server port (default: 11219)")
    parser.add_argument("--force", action="store_true",
                        help="Force re-convert + re-build index even if consistent")

    args = parser.parse_args()
    root_path = Path(args.root_path).resolve()

    if not root_path.is_dir():
        print(f"[launch] Error: {root_path} is not a directory", flush=True)
        sys.exit(1)

    sys.path.insert(0, str(Path(__file__).parent / "server"))
    sys.path.insert(0, str(Path(__file__).parent))

    result_dir = root_path / "wiki_result"

    # ---- 一致性检查 ----
    consistent = is_build_consistent(result_dir) and not args.force
    if consistent:
        print(f"[launch] ✓ wiki_index.json 已存在且和 wiki_result 一致,跳过转换和建索引", flush=True)
    else:
        reason = "force=true" if args.force else ("wiki_result 为空或 index 不一致")
        print(f"[launch] → 需要构建 ({reason})", flush=True)

        # ---- 转换 ----
        print(f"[launch] 开始转换 .md / .meta.json → wiki_result/...", flush=True)
        conv = convert_raw_to_wiki_result(root_path)
        print(f"[launch] ✓ 转换完成: {conv['converted']} / {conv['scanned']} 个文件", flush=True)

        # ---- 建 index ----
        print(f"[launch] 开始生成 wiki_index.json (LLM 摘要)...", flush=True)
        from build_wiki_index import build_index
        try:
            asyncio.run(build_index(
                result_dir,
                use_llm=True,
                concurrency=10,
                force=args.force,
                verbose=False,
            ))
            print(f"[launch] ✓ wiki_index.json 生成完成", flush=True)
        except Exception as e:
            print(f"[launch] ✗ 建索引失败: {e}", flush=True)
            # 不退出,让后端仍然能启动(即便没 index,wiki 浏览仍可用)

    # ---- 启动 uvicorn ----
    os.environ["WIKI_ROOT_PATH"] = str(result_dir)
    print(f"[launch] 启动后端: http://localhost:{args.port} (WIKI_ROOT_PATH={result_dir})", flush=True)

    import uvicorn
    from server import app
    uvicorn.run(app, host="0.0.0.0", port=args.port)


if __name__ == "__main__":
    main()
