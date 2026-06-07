import type { ReplayCase, ReplayRound } from "../lib/replay";

type SubAgentLanesProps = {
  round: ReplayRound;
  selectedCaseId: string;
  onSelectCase: (item: ReplayCase) => void;
};

function outcomeLabel(item: ReplayCase): string {
  if (item.breach) return "Breach";
  if (item.falsePositive) return "False positive";
  if (item.actualDecision === item.expectedDecision) return "Expected";
  return "Mismatch";
}

export function SubAgentLanes({ round, selectedCaseId, onSelectCase }: SubAgentLanesProps) {
  return (
    <section className="panel">
      <div className="section-heading">
        <p className="eyebrow">Selected round</p>
        <h2>{round.title}</h2>
        <p>{round.narrative}</p>
      </div>

      <div className="lane-list">
        {round.cases.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`lane-card ${selectedCaseId === item.id ? "selected" : ""}`}
            onClick={() => onSelectCase(item)}
          >
            <div className="lane-card-header">
              <span className="lane-label">{item.laneLabel}</span>
              <span className={`badge ${item.breach ? "danger" : item.falsePositive ? "warning" : "success"}`}>
                {outcomeLabel(item)}
              </span>
            </div>
            <strong>{item.attackFamily}</strong>
            <p>{item.payload}</p>
            <div className="decision-row">
              <span>Expected: {item.expectedDecision}</span>
              <span>Actual: {item.actualDecision}</span>
            </div>
          </button>
        ))}
      </div>
    </section>
  );
}
