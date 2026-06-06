"""
Deterministic loan scoring engine.

Each of the 8 categories produces a score in [0.0, 1.0].
The weighted total determines approve (>= THRESHOLD) or deny (< THRESHOLD).
Weights sum to exactly 1.0.
"""

WEIGHTS: dict[str, float] = {
    "credit":            0.25,
    "income_employment": 0.20,
    "debt":              0.20,
    "loan_request":      0.15,
    "assets":            0.10,
    "banking":           0.05,
    "identity":          0.03,
    "fraud":             0.02,
}

APPROVE_THRESHOLD = 0.50


# ---------------------------------------------------------------------------
# Per-category scorers
# ---------------------------------------------------------------------------

def _score_credit(credit_score: int, num_late_payments: int, bankruptcies: int) -> float:
    if credit_score >= 750:
        base = 1.00
    elif credit_score >= 700:
        base = 0.85
    elif credit_score >= 650:
        base = 0.65
    elif credit_score >= 600:
        base = 0.45
    elif credit_score >= 550:
        base = 0.25
    else:
        base = 0.00
    deduction = min(num_late_payments * 0.10, 0.30)
    if bankruptcies > 0:
        deduction += 0.40
    return max(0.0, base - deduction)


def _score_income_employment(
    annual_income: float, employment_status: str, years_employed: float
) -> float:
    if annual_income >= 100_000:
        base = 1.00
    elif annual_income >= 75_000:
        base = 0.85
    elif annual_income >= 50_000:
        base = 0.65
    elif annual_income >= 30_000:
        base = 0.40
    else:
        base = 0.10

    multipliers = {
        "employed":      1.00,
        "retired":       0.90,
        "self_employed": 0.85,
        "unemployed":    0.20,
    }
    score = base * multipliers.get(employment_status.lower(), 0.50)

    if years_employed >= 5:
        score += 0.10
    elif years_employed >= 2:
        score += 0.05

    return min(1.0, score)


def _score_debt(monthly_debt_payments: float, annual_income: float) -> float:
    if annual_income <= 0:
        return 0.0
    dti = monthly_debt_payments / (annual_income / 12)
    if dti < 0.20:
        return 1.00
    elif dti < 0.35:
        return 0.75
    elif dti < 0.43:
        return 0.50
    elif dti < 0.50:
        return 0.25
    else:
        return 0.00


def _score_loan_request(requested_amount: float, annual_income: float) -> float:
    if annual_income <= 0:
        return 0.0
    ratio = requested_amount / annual_income
    if ratio < 0.30:
        return 1.00
    elif ratio < 0.50:
        return 0.80
    elif ratio < 1.00:
        return 0.60
    elif ratio < 2.00:
        return 0.30
    else:
        return 0.00


def _score_assets(
    total_assets: float, collateral_value: float, requested_amount: float
) -> float:
    if requested_amount <= 0:
        return 1.0
    coverage = total_assets / requested_amount
    if coverage > 3.0:
        score = 1.00
    elif coverage >= 2.0:
        score = 0.80
    elif coverage >= 1.0:
        score = 0.50
    elif coverage >= 0.5:
        score = 0.30
    else:
        score = 0.00
    if collateral_value > 0:
        score = min(1.0, score + 0.10)
    return score


def _score_banking(months_of_savings: float) -> float:
    if months_of_savings >= 6:
        return 1.00
    elif months_of_savings >= 3:
        return 0.70
    elif months_of_savings >= 1:
        return 0.40
    else:
        return 0.10


def _score_identity(identity_verified: bool, age: int) -> float:
    score = 1.00 if identity_verified else 0.00
    if not (25 <= age <= 65):
        score *= 0.80
    return score


def _score_fraud(fraud_flags: int) -> float:
    if fraud_flags == 0:
        return 1.00
    elif fraud_flags == 1:
        return 0.50
    else:
        return 0.00


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------

def compute_score(
    credit_score: int,
    num_late_payments: int,
    bankruptcies: int,
    annual_income: float,
    employment_status: str,
    years_employed: float,
    monthly_debt_payments: float,
    requested_amount: float,
    total_assets: float,
    collateral_value: float,
    months_of_savings: float,
    identity_verified: bool,
    age: int,
    fraud_flags: int,
) -> dict:
    """Return per-category scores, weighted total, and approve/deny decision."""
    category_scores = {
        "credit":            _score_credit(credit_score, num_late_payments, bankruptcies),
        "income_employment": _score_income_employment(annual_income, employment_status, years_employed),
        "debt":              _score_debt(monthly_debt_payments, annual_income),
        "loan_request":      _score_loan_request(requested_amount, annual_income),
        "assets":            _score_assets(total_assets, collateral_value, requested_amount),
        "banking":           _score_banking(months_of_savings),
        "identity":          _score_identity(identity_verified, age),
        "fraud":             _score_fraud(fraud_flags),
    }

    weighted_total = round(
        sum(category_scores[k] * WEIGHTS[k] for k in WEIGHTS), 4
    )

    return {
        "category_scores": category_scores,
        "weights": WEIGHTS,
        "weighted_total": weighted_total,
        "threshold": APPROVE_THRESHOLD,
        "approve": weighted_total >= APPROVE_THRESHOLD,
    }
