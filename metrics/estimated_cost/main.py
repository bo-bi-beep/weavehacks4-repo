import json

# gpt-4o-mini pricing (USD per token)
_PRICING = {
    "input":        0.150 / 1_000_000,
    "cached_input": 0.075 / 1_000_000,  # 50% discount for cached prompt tokens
    "output":       0.600 / 1_000_000,
}


def calculate_estimated_cost(json_filepath):
    """
    Estimate OpenAI API cost from token usage in Weave traces.
    Cached input tokens are charged at 50% of the standard input rate.

    Returns (total_cost_usd, cost_per_trace, trace_count)
    """
    with open(json_filepath) as f:
        data = json.load(f)

    total_cost = 0.0

    for trace in data:
        usage = trace.get("summary", {}).get("usage", {})
        for _, metrics in usage.items():
            prompt_tokens = metrics.get("prompt_tokens", 0)
            completion_tokens = metrics.get("completion_tokens", 0)
            cached_tokens = (
                metrics.get("cache_read_input_tokens", 0)
                or metrics.get("prompt_tokens_details", {}).get("cached_tokens", 0)
            )
            non_cached_input = max(0, prompt_tokens - cached_tokens)

            total_cost += (
                non_cached_input  * _PRICING["input"]
                + cached_tokens   * _PRICING["cached_input"]
                + completion_tokens * _PRICING["output"]
            )

    trace_count = len(data)
    cost_per_trace = total_cost / trace_count if trace_count else 0.0

    return round(total_cost, 6), round(cost_per_trace, 6), trace_count


if __name__ == "__main__":
    total, per_trace, count = calculate_estimated_cost("../../testdata/attack_results.json")
    print(f"Traces:          {count}")
    print(f"Total cost:      ${total:.6f}")
    print(f"Cost per trace:  ${per_trace:.6f}")
