import json
import re

_DECISION_RE = re.compile(r'\*\*(?:Loan )?Decision:\*\*\s*([A-Za-z]+)', re.IGNORECASE)


def calculate_decision_distribution(json_filepath):
    """
    Count approved vs denied decisions across all traces.

    Returns (approved_count, denied_count, approved_pct, denied_pct)
    """
    with open(json_filepath) as f:
        data = json.load(f)

    approved = 0
    denied = 0

    for trace in data:
        output = trace.get("output", "")
        m = _DECISION_RE.search(output)
        if not m:
            continue
        decision = m.group(1).strip().lower()
        if decision == "approved":
            approved += 1
        elif decision == "denied":
            denied += 1

    total = approved + denied
    approved_pct = round(approved / total * 100, 2) if total else 0.0
    denied_pct = round(denied / total * 100, 2) if total else 0.0

    return approved, denied, approved_pct, denied_pct


if __name__ == "__main__":
    approved, denied, approved_pct, denied_pct = calculate_decision_distribution(
        "../../testdata/attack_results.json"
    )
    print(f"Approved:  {approved} ({approved_pct}%)")
    print(f"Denied:    {denied}  ({denied_pct}%)")
