#!/usr/bin/env python3
"""
递归将目录及子目录下所有 .json 文件重命名为 .meta.json
"""

import sys
from pathlib import Path


def rename_json_to_meta_json(directory: str, dry_run: bool = False):
    """
    递归将指定目录及其子目录下所有 .json 文件重命名为 .meta.json

    Args:
        directory: 目标目录路径
        dry_run: 如果为 True，只打印将要执行的操作，不实际重命名
    """
    dir_path = Path(directory)

    if not dir_path.exists():
        print(f"错误: 目录 '{directory}' 不存在")
        return

    if not dir_path.is_dir():
        print(f"错误: '{directory}' 不是一个目录")
        return

    # 递归查找所有 .json 文件（排除已经是 .meta.json 的文件）
    json_files = [f for f in dir_path.glob("**/*.json") if not f.name.endswith(".meta.json")]

    if not json_files:
        print("没有找到需要重命名的 .json 文件")
        return

    print(f"找到 {len(json_files)} 个 .json 文件需要重命名:\n")

    for json_file in json_files:
        # 构造新文件名: example.json -> example.meta.json
        new_name = json_file.stem + ".meta.json"
        new_path = json_file.parent / new_name
        relative_path = json_file.relative_to(dir_path)
        relative_new_path = new_path.relative_to(dir_path)

        if dry_run:
            print(f"  [预览] {relative_path} -> {relative_new_path}")
        else:
            if new_path.exists():
                print(f"  [跳过] {relative_path} -> {relative_new_path} (目标文件已存在)")
            else:
                json_file.rename(new_path)
                print(f"  [完成] {relative_path} -> {relative_new_path}")

    print("\n操作完成!")


if __name__ == "__main__":
    # 默认使用当前目录
    target_dir = sys.argv[1] if len(sys.argv) > 1 else "."

    # 检查是否为预览模式
    dry_run = "--dry-run" in sys.argv or "-n" in sys.argv

    if dry_run:
        print("=== 预览模式 (不会实际修改文件) ===\n")

    rename_json_to_meta_json(target_dir, dry_run)
