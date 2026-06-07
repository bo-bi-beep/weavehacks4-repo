import type { ReplayRound } from "../lib/replay";

type AttackTimelineProps = {
  rounds: ReplayRound[];
  selectedRoundId: string;
  onSelectRound: (roundId: string) => void;
};

export function AttackTimeline({ rounds, selectedRoundId, onSelectRound }: AttackTimelineProps) {
  return (
    <section className="panel timeline-panel">
      <div className="section-heading">
        <h2>Attack, fix, regression, repair</h2>
      </div>
      <div className="timeline">
        {rounds.map((round, index) => {
          const isSelected = round.id === selectedRoundId;
          const breachCount = round.cases.filter((item) => item.breach).length;
          const falsePositiveCount = round.cases.filter((item) => item.falsePositive).length;
          return (
            <button
              key={round.id}
              className={`timeline-step ${isSelected ? "selected" : ""}`}
              type="button"
              onClick={() => onSelectRound(round.id)}
            >
              <span className="step-index">{index + 1}</span>
              <span className="step-title">{round.title}</span>
              <span className="step-metrics">
                {breachCount ? `${breachCount} breach` : "no breach"}
                {" · "}
                {falsePositiveCount ? `${falsePositiveCount} false positive` : "no false positives"}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
