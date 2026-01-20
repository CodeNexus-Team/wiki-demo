#!/usr/bin/env python3
"""Start both frontend and backend servers simultaneously."""

import argparse
import os
import sys
import subprocess
import signal
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description="Start wiki demo frontend and backend servers")
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

    # Get the script directory
    script_dir = Path(__file__).parent
    frontend_dir = script_dir / "frontend"

    if not frontend_dir.exists():
        print(f"Error: Frontend directory '{frontend_dir}' does not exist")
        sys.exit(1)

    print("Starting wiki demo servers...")
    print("=" * 50)

    processes = []

    try:
        # Start backend server
        backend_cmd = [sys.executable, str(script_dir / "demo.py"), str(root_path)]
        if args.c is not None:
            backend_cmd.append("c")

        print(f"Starting backend server: {' '.join(backend_cmd)}")
        backend_process = subprocess.Popen(
            backend_cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1
        )
        processes.append(("Backend", backend_process))

        # Start frontend server
        print(f"Starting frontend server in: {frontend_dir}")
        frontend_process = subprocess.Popen(
            ["npm", "run", "dev"],
            cwd=str(frontend_dir),
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1
        )
        processes.append(("Frontend", frontend_process))

        print("=" * 50)
        print("Both servers are starting...")
        print("Press Ctrl+C to stop all servers")
        print("=" * 50)

        # Monitor both processes and print their output
        import select
        import time

        while True:
            for name, process in processes:
                # Check if process is still running
                if process.poll() is not None:
                    print(f"\n{name} server stopped unexpectedly!")
                    raise KeyboardInterrupt

                # Read output if available
                try:
                    line = process.stdout.readline()
                    if line:
                        print(f"[{name}] {line.rstrip()}")
                except:
                    pass

            time.sleep(0.1)

    except KeyboardInterrupt:
        print("\n\nStopping all servers...")

    finally:
        # Terminate all processes
        for name, process in processes:
            if process.poll() is None:
                print(f"Stopping {name} server...")
                process.terminate()
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    print(f"Force killing {name} server...")
                    process.kill()

        print("All servers stopped.")


if __name__ == "__main__":
    main()
