import type { ReplayCase, ReplayRound } from "../lib/replay";

type RegressionMatrixProps = {
  rounds: ReplayRound[];
  selectedCaseId: string;
  onSelectCase: (roundId: string, lane: string) => void;
};

function statusFor(item: ReplayCase): string {
  if (item.breach) return "Attack passed";
  if (item.falsePositive) return "Normal blocked";
  return "Correct";
}

export function RegressionMatrix({ rounds, selectedCaseId, onSelectCase }: RegressionMatrixProps) {
  const rows = rounds.flatMap((round) =>
    round.cases.map((item) => ({
      round,
      item,
    })),
  );

  return (
    <section className="panel">
      <div className="section-heading">
        <h2>Regression matrix</h2>
      </div>

      <div className="matrix">
        {rows.map(({ round, item }) => (
          <button
            key={`${round.id}-${item.id}`}
            type="button"
            className={`matrix-cell ${selectedCaseId === item.id ? "selected" : ""} ${
              item.breach ? "danger" : item.falsePositive ? "warning" : "success"
            }`}
            onClick={() => onSelectCase(round.id, item.lane)}
          >
            <span>{round.title}</span>
            <strong>{item.targetUser}</strong>
            <em>{statusFor(item)}</em>
          </button>
        ))}
      </div>
    </section>
  );
}
