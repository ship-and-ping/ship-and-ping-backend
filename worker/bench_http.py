"""Run from worker/ after cargo build --release --example bench."""
import http.client
import json
import statistics
import subprocess
import time

import socket
import sys

def measure(ascii_only):
    args = ["target/release/examples/bench", "--body"]
    if ascii_only:
        args.append("--ascii")
    body = subprocess.check_output(args)
    assert len(body) == 65536
    conn = http.client.HTTPConnection("127.0.0.1", 8787, timeout=15)
    samples = []
    for i in range(110):
        start = time.perf_counter_ns()
        conn.request("POST", "/v1/ingest", body, {
            "Content-Type": "application/json", "Authorization": "_".join(["Bearer sp", "pub", f"bench{ascii_only}{i}"])
        })
        response = conn.getresponse()
        result = json.loads(response.read())
        elapsed = (time.perf_counter_ns() - start) / 1e6
        assert response.status == 202 and result == {"accepted": 100, "dropped": 0}, result
        if i >= 10:
            samples.append(elapsed)
    conn.close()
    print(f"{'ASCII' if ascii_only else 'Korean'} n=100 median={statistics.median(samples):.3f} ms max={max(samples):.3f} ms")


if "--start-local" in sys.argv:
    with subprocess.Popen([
        "node", "target/wrangler/node_modules/wrangler/bin/wrangler.js",
        "dev", "--local", "--ip", "127.0.0.1", "--port", "8787",
        "--var", "INGEST_DRY_RUN:true",
    ]) as server:
        try:
            deadline = time.monotonic() + 180
            while server.poll() is None and time.monotonic() < deadline:
                try:
                    with socket.create_connection(("127.0.0.1", 8787), timeout=1):
                        break
                except OSError:
                    time.sleep(0.25)
            else:
                raise RuntimeError("Wrangler startup failed")
            measure(True)
            measure(False)
        finally:
            server.terminate()
else:
    measure("--ascii" in sys.argv)
