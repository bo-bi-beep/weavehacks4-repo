import json


def calculate_latency(json_filepath):
    """
    Compute latency statistics (ms) from Weave trace summaries.

    Returns (mean_ms, min_ms, max_ms, p50_ms, p95_ms, trace_count)
    """
    with open(json_filepath) as f:
        data = json.load(f)

    latencies = []
    for trace in data:
        ms = trace.get("summary", {}).get("weave", {}).get("latency_ms")
        if ms is not None:
            latencies.append(ms)

    if not latencies:
        return 0.0, 0.0, 0.0, 0.0, 0.0, 0

    latencies.sort()
    n = len(latencies)

    def percentile(sorted_list, pct):
        idx = max(0, int(pct / 100 * n) - 1)
        return sorted_list[idx]

    mean_ms = round(sum(latencies) / n, 1)
    min_ms = latencies[0]
    max_ms = latencies[-1]
    p50_ms = percentile(latencies, 50)
    p95_ms = percentile(latencies, 95)

    return mean_ms, min_ms, max_ms, p50_ms, p95_ms, n


if __name__ == "__main__":
    mean, mn, mx, p50, p95, count = calculate_latency("../../testdata/attack_results.json")
    print(f"Traces:   {count}")
    print(f"Mean:     {mean} ms")
    print(f"Min:      {mn} ms")
    print(f"Max:      {mx} ms")
    print(f"p50:      {p50} ms")
    print(f"p95:      {p95} ms")
