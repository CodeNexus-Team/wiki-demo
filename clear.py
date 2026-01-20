#!/usr/bin/env python3
"""Clear all JSON files from a specified directory."""

import argparse
import sys
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description="Clear all JSON files from a directory")
    parser.add_argument("target_path", help="Target directory to clear JSON files from")
    parser.add_argument("-f", "--force", action="store_true", help="Force deletion without confirmation")
    parser.add_argument("-r", "--recursive", action="store_true", default=True, help="Recursively delete JSON files in subdirectories (default: True)")
    parser.add_argument("--no-recursive", dest="recursive", action="store_false", help="Only delete JSON files in the target directory, not subdirectories")

    args = parser.parse_args()
    target_path = Path(args.target_path).resolve()

    if not target_path.exists():
        print(f"Error: Path '{target_path}' does not exist")
        sys.exit(1)

    if not target_path.is_dir():
        print(f"Error: Path '{target_path}' is not a directory")
        sys.exit(1)

    # Find all JSON files
    if args.recursive:
        json_files = list(target_path.rglob("*.json"))
    else:
        json_files = list(target_path.glob("*.json"))

    if not json_files:
        print(f"No JSON files found in: {target_path}")
        sys.exit(0)

    # Display information
    print(f"Target directory: {target_path}")
    print(f"Found {len(json_files)} JSON file(s)")

    if len(json_files) <= 10:
        print("\nFiles to be deleted:")
        for json_file in json_files:
            print(f"  - {json_file.relative_to(target_path)}")
    else:
        print("\nFirst 10 files to be deleted:")
        for json_file in json_files[:10]:
            print(f"  - {json_file.relative_to(target_path)}")
        print(f"  ... and {len(json_files) - 10} more files")

    # Confirmation
    if not args.force:
        print()
        response = input("Are you sure you want to delete these files? (yes/no): ")
        if response.lower() not in ["yes", "y"]:
            print("Operation cancelled.")
            sys.exit(0)

    # Perform deletion
    try:
        print(f"\nDeleting JSON files...")
        deleted_count = 0

        for json_file in json_files:
            json_file.unlink()
            deleted_count += 1
            if deleted_count <= 10 or deleted_count % 10 == 0:
                print(f"  Deleted {deleted_count}/{len(json_files)}: {json_file.name}")

        print(f"\n✓ Successfully deleted {deleted_count} JSON file(s)")

        # Remove empty directories if recursive mode
        if args.recursive:
            empty_dirs_removed = 0
            for dirpath in sorted(target_path.rglob("*"), reverse=True):
                if dirpath.is_dir() and dirpath != target_path and not any(dirpath.iterdir()):
                    dirpath.rmdir()
                    empty_dirs_removed += 1

            if empty_dirs_removed > 0:
                print(f"✓ Removed {empty_dirs_removed} empty director{'y' if empty_dirs_removed == 1 else 'ies'}")

    except Exception as e:
        print(f"\n✗ Error during deletion: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
