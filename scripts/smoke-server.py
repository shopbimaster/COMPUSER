# Compatibility entry point: serve only application assets on localhost.
from pathlib import Path
import subprocess

if __name__ == "__main__":
    raise SystemExit(subprocess.call(["node", str(Path(__file__).with_name("dev-server.cjs"))]))
