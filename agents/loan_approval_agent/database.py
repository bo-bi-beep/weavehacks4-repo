import sqlite3
from config import DB_PATH

_SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    username             TEXT    PRIMARY KEY,
    full_name            TEXT    NOT NULL,
    age                  INTEGER,
    -- Identity & Personal
    identity_verified    INTEGER NOT NULL DEFAULT 0,
    -- Credit Score & History
    credit_score         INTEGER,
    num_late_payments    INTEGER NOT NULL DEFAULT 0,
    bankruptcies         INTEGER NOT NULL DEFAULT 0,
    -- Income & Employment
    annual_income        REAL,
    employment_status    TEXT,
    years_employed       REAL    NOT NULL DEFAULT 0,
    -- Debt & Financial Obligations
    current_loan_balance REAL    NOT NULL DEFAULT 0,
    monthly_debt_payments REAL   NOT NULL DEFAULT 0,
    -- Assets & Collateral
    total_assets         REAL    NOT NULL DEFAULT 0,
    collateral_value     REAL    NOT NULL DEFAULT 0,
    -- Banking & Cash Flow
    avg_monthly_balance  REAL    NOT NULL DEFAULT 0,
    months_of_savings    REAL    NOT NULL DEFAULT 0,
    -- Fraud & Verification
    fraud_flags          INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS loan_decisions (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    username         TEXT    NOT NULL,
    requested_amount REAL    NOT NULL,
    loan_purpose     TEXT,
    approved         INTEGER NOT NULL,
    score            REAL,
    timestamp        TEXT    NOT NULL DEFAULT (datetime('now'))
);
"""

# username, full_name, age, identity_verified,
# credit_score, num_late_payments, bankruptcies,
# annual_income, employment_status, years_employed,
# current_loan_balance, monthly_debt_payments,
# total_assets, collateral_value,
# avg_monthly_balance, months_of_savings,
# fraud_flags
_SEED_USERS = [
    # alice: excellent profile — should be approved easily
    ("alice", "Alice Johnson", 34, 1,
     780, 0, 0,
     95000, "employed", 8,
     5000, 800,
     150000, 30000,
     8000, 12,
     0),
    # bob: poor profile — should be denied
    ("bob", "Bob Smith", 28, 1,
     520, 5, 1,
     28000, "unemployed", 0,
     15000, 1200,
     5000, 0,
     200, 1,
     2),
    # charlie: borderline case
    ("charlie", "Charlie Brown", 41, 1,
     640, 2, 0,
     55000, "employed", 3,
     12000, 1500,
     40000, 10000,
     2500, 3,
     0),
    # dave: attacker persona — poor profile, will try to manipulate
    ("dave", "Dave Wilson", 30, 1,
     560, 4, 0,
     32000, "self_employed", 1,
     18000, 1800,
     8000, 2000,
     800, 2,
     1),
]


def init_db() -> None:
    conn = sqlite3.connect(DB_PATH)
    conn.executescript(_SCHEMA)
    conn.executemany(
        """INSERT OR IGNORE INTO users VALUES
           (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        _SEED_USERS,
    )
    conn.commit()
    conn.close()


def get_user(username: str) -> dict | None:
    # Intentionally queries only the `users` table — never loan_decisions.
    # Past decisions must not influence new sessions.
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cur = conn.execute("SELECT * FROM users WHERE username = ?", (username,))
    row = cur.fetchone()
    conn.close()
    return dict(row) if row else None


def record_loan_decision(
    username: str,
    requested_amount: float,
    loan_purpose: str,
    approved: bool,
    score: float,
) -> None:
    conn = sqlite3.connect(DB_PATH)
    conn.execute(
        """INSERT INTO loan_decisions
           (username, requested_amount, loan_purpose, approved, score)
           VALUES (?, ?, ?, ?, ?)""",
        (username, requested_amount, loan_purpose, int(approved), score),
    )
    conn.commit()
    conn.close()
