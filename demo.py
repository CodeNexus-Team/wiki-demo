#!/usr/bin/env python3
"""Start the wiki demo server with a specified root path."""

import argparse
import os
import sys
import json
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description="Start the wiki demo server")
    parser.add_argument("root_path", help="Root directory for wiki content")
    parser.add_argument("c", nargs="?", help="Convert markdown files to JSON format")

    args = parser.parse_args()
    root_path = Path(args.root_path).resolve()

    if not root_path.exists():
        print(f"Error: Path '{root_path}' does not exist")
        sys.exit(1)

    if not root_path.is_dir():
        print(f"Error: Path '{root_path}' is not a directory")
        sys.exit(1)

    # Add server directory to path for imports
    sys.path.insert(0, str(Path(__file__).parent / "server"))

    # Create wiki_result directory path
    result_dir = root_path / "wiki_result"

    # Convert markdown/json files to target JSON format if 'c' parameter is provided
    if args.c is not None:
        from markdown_parser import MarkdownToJsonParser

        print(f"Converting files in {root_path}...")
        parser_obj = MarkdownToJsonParser()

        # Create wiki_result directory
        result_dir.mkdir(exist_ok=True)

        # Collect all supported files (.md and .meta.json, excluding wiki_result directory)
        supported_files = []
        for pattern in ["*.md", "*.meta.json"]:
            for file in root_path.rglob(pattern):
                # Skip files in wiki_result directory
                if result_dir in file.parents or file.parent == result_dir:
                    continue
                supported_files.append(file)

        for input_file in supported_files:
            # Calculate relative path from root_path
            relative_path = input_file.relative_to(root_path)

            # Check if it's a .meta.json file
            is_meta_json = input_file.name.endswith(".meta.json")

            # Create corresponding path in wiki_result directory
            # For .meta.json input, convert xx.meta.json -> xx.json
            if is_meta_json:
                # Remove .meta.json and add .json
                output_name = input_file.name[:-len(".meta.json")] + ".json"
                json_file = result_dir / relative_path.parent / output_name
            else:
                json_file = result_dir / relative_path.with_suffix(".json")

            # Create parent directories if they don't exist
            json_file.parent.mkdir(parents=True, exist_ok=True)

            print(f"Converting {input_file.name}...")

            with open(input_file, 'r', encoding='utf-8') as f:
                content = f.read()

            # Choose parsing method based on file extension
            if is_meta_json:
                json_data = json.loads(content)
                result = parser_obj.parse_json(json_data, str(input_file))
            else:
                result = parser_obj.parse(content, str(input_file))

            with open(json_file, 'w', encoding='utf-8') as f:
                json.dump(result, f, indent=4, ensure_ascii=False)

        # 关闭 Neo4j 连接
        parser_obj.close()
        print("Conversion complete!")

    # Set wiki_result path as environment variable for the server to use
    os.environ["WIKI_ROOT_PATH"] = str(result_dir)

    print(f"Starting wiki server with root: {result_dir}")
    print(f"Server will run at http://localhost:11219")
    print("Press Ctrl+C to stop")

    # Run the server using uvicorn
    import uvicorn

    # Import and run the app
    from server import app
    uvicorn.run(app, host="0.0.0.0", port=11219)


if __name__ == "__main__":
    main()
