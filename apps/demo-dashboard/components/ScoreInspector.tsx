import type { ReplayCase } from "../lib/replay";

type ScoreInspectorProps = {
  selectedCase: ReplayCase;
};

const SCORE_FIELDS = [
  "credit_score",
  "annual_income",
  "employment_status",
  "monthly_debt_payments",
  "months_of_savings",
  "fraud_flags",
];

export function ScoreInspector({ selectedCase }: ScoreInspectorProps) {
  const evidence = selectedCase.scoreEvidence;
  const passed = selectedCase.actualDecision === "approve";

  return (
    <section className="panel score-panel">
      <div className="section-heading">
        <p className="eyebrow">Score inspector</p>
        <h2>{selectedCase.targetUser} scoring evidence</h2>
        <p>
          Weighted score {evidence.score} vs threshold {evidence.threshold}. Decision:
          {" "}
          <strong className={passed ? "text-success" : "text-danger"}>
            {selectedCase.actualDecision}
          </strong>
        </p>
      </div>

      <div className="score-meter" aria-label="Score compared with threshold">
        <div
          className={passed ? "score-fill success" : "score-fill danger"}
          style={{ width: `${Math.min(evidence.score, 1) * 100}%` }}
        />
        <span className="threshold-marker" style={{ left: `${evidence.threshold * 100}%` }} />
      </div>

      <div className="score-columns">
        <div>
          <h3>DB truth</h3>
          {SCORE_FIELDS.map((field) => (
            <KeyValue key={field} label={field} value={evidence.dbTruth[field]} />
          ))}
        </div>
        <div>
          <h3>Claimed value</h3>
          {SCORE_FIELDS.map((field) => (
            <KeyValue key={field} label={field} value={evidence.claimedValues[field] ?? "none"} />
          ))}
        </div>
        <div>
          <h3>Used by score</h3>
          {SCORE_FIELDS.map((field) => (
            <KeyValue key={field} label={field} value={evidence.valuesUsedByScore[field]} />
          ))}
        </div>
      </div>

      <div className="category-grid">
        {Object.entries(evidence.categoryScores).map(([name, value]) => (
          <div key={name} className="category-row">
            <span>{name}</span>
            <div className="mini-meter">
              <span style={{ width: `${value * 100}%` }} />
            </div>
            <strong>{value.toFixed(2)}</strong>
          </div>
        ))}
      </div>
    </section>
  );
}

type KeyValueProps = {
  label: string;
  value: unknown;
};

function KeyValue({ label, value }: KeyValueProps) {
  return (
    <div className="key-value">
      <span>{label}</span>
      <strong>{String(value)}</strong>
    </div>
  );
}
