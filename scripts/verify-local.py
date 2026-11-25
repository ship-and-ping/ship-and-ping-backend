"""Run from the repository root. Only the uniquely named T10 stack is removed."""
import json
import os
from pathlib import Path
import shutil
import signal
import socket
import subprocess
import tempfile
import time
from contextlib import ExitStack
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[1]
WORKER = ROOT / "worker"
CLI = ["npx", "--yes", "supabase@2.75.0"]
os.environ["PATH"] += os.pathsep + str(Path.home() / ".cargo/bin")
os.environ["SUPABASE_TELEMETRY_DISABLED"] = "true"


def run(*args, cwd=ROOT, **kwargs):
    return subprocess.run(args, cwd=cwd, check=True, **kwargs)


def stop(process):
    if process.poll() is None:
        process.terminate()
        try:
            process.wait(5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()


def interrupt(signum, frame):
    raise KeyboardInterrupt


def verify(tmp, stack):
    project = "ship-and-ping-t10-" + uuid4().hex[:10]
    os.environ["T10_PROJECT"] = project
    chrome = os.getenv("CHROME_BIN") or shutil.which("chromium") or "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    if not Path(chrome).is_file():
        raise SystemExit("Set CHROME_BIN to the installed Chromium/Chrome executable.")
    for port in [57420, 57421, 57422, 58781, 58782, 58783, 58784]:
        with socket.socket() as probe:
            probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            probe.bind(("127.0.0.1", port))
    for directory in ["migrations", "tests"]:
        shutil.copytree(ROOT / "supabase" / directory, tmp / "supabase" / directory)
    config = (ROOT / "scripts/t10-config.toml").read_text().replace("ship-and-ping-t10", project)
    (tmp / "supabase/config.toml").write_text(config)
    shutil.copytree(ROOT / "web", tmp / "web", ignore=shutil.ignore_patterns("node_modules", "dist", ".env*", ".vite"))
    shutil.copytree(ROOT / "docs", tmp / "docs")
    run("npm", "ci", cwd=tmp / "web")
    run("npm", "test", cwd=tmp / "web")
    shutil.copy(ROOT / "scripts/t10-gallery.mjs", tmp / "gallery.mjs")
    run("node", "gallery.mjs", cwd=tmp)
    run("npm", "install", "--no-save", "playwright-core@1.56.1", cwd=tmp)
    run("cargo", "test", "--locked", cwd=WORKER)
    run("worker-build", "--release", cwd=WORKER)
    run("npm", "install", "--prefix", "target/workerd", "--no-save", "workerd@1.20261123.1", cwd=WORKER)
    run("cargo", "test", "--locked", "--test", "http", "--", "--ignored", cwd=WORKER)
    stack.callback(run, *CLI, "stop", "--no-backup", "--workdir", tmp)
    run(*CLI, "start", "--exclude", "imgproxy,logflare,vector,supavisor,postgres-meta",
        "--workdir", tmp, stdout=subprocess.DEVNULL)
    run(*CLI, "test", "db", "--local", "--workdir", tmp)
    status = json.loads(run(*CLI, "status", "--output", "json", "--workdir", tmp,
                            stdout=subprocess.PIPE).stdout)
    (tmp / "status.json").write_text(json.dumps(status))
    (tmp / "db-key").write_text(status["SECRET_KEY"])
    for name in ["index.js", "index_bg.wasm"]:
        shutil.copy(WORKER / "build" / name, tmp)
    for name in ["entry.js", "router.js", "worker.capnp", "scenario.mjs"]:
        shutil.copy(ROOT / "scripts" / ("t10-" + name), tmp / name)
    worker = subprocess.Popen([WORKER / "target/workerd/node_modules/.bin/workerd", "serve", "worker.capnp"], cwd=tmp)
    stack.callback(stop, worker)
    shutil.copytree(ROOT / "examples", tmp / "examples")
    static = subprocess.Popen(["python3", "-m", "http.server", "58784", "--bind", "127.0.0.1",
                               "--directory", tmp / "examples"], stderr=subprocess.DEVNULL)
    stack.callback(stop, static)
    for _ in range(100):
        try:
            with socket.create_connection(("127.0.0.1", 58781), timeout=1):
                break
        except OSError:
            if worker.poll() is not None:
                raise RuntimeError("workerd exited")
            time.sleep(0.1)
    run("node", "scenario.mjs", ROOT, chrome, cwd=tmp)
    run("bash", "scripts/check-deliverables.sh")
    leaks = os.getenv("GITLEAKS_BIN") or shutil.which("gitleaks")
    if leaks:
        run(leaks, "git", "--redact", "--no-banner", "--log-opts=HEAD")
    else:
        print("C11 requires the PR secrets check (or set GITLEAKS_BIN).")


if __name__ == "__main__":
    signal.signal(signal.SIGTERM, interrupt)
    with tempfile.TemporaryDirectory(prefix="ship-ping-t10-") as path, ExitStack() as resources:
        verify(Path(path), resources)
