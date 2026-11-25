"""Run from worker/ after cargo build --release --example bench."""
import http.client
import json
import statistics
import subprocess
import time

body = subprocess.check_output(["target/release/examples/bench", "--body"])
assert len(body) == 65536
conn = http.client.HTTPConnection("127.0.0.1", 8787, timeout=15)
samples = []
for i in range(110):
    start = time.perf_counter_ns()
    conn.request("POST", "/v1/ingest", body, {
        "Content-Type": "application/json", "Authorization": "Bearer sp_pub_fixture"
    })
    response = conn.getresponse()
    result = json.loads(response.read())
    elapsed = (time.perf_counter_ns() - start) / 1e6
    assert response.status == 202 and result == {"accepted": 100, "dropped": 0}, result
    if i >= 10:
        samples.append(elapsed)
conn.close()
print(f"n=100 median={statistics.median(samples):.3f} ms max={max(samples):.3f} ms")
