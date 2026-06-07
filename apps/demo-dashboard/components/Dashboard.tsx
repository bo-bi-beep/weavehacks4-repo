"use client";

import { useMemo, useState } from "react";

import {
  getReplaySummary,
  getSelectedCase,
  replayRounds,
  type ReplayCase,
  type ReplayRound,
} from "../lib/replay";
import { AttackTimeline } from "./AttackTimeline";
import { RegressionMatrix } from "./RegressionMatrix";
import { ScoreInspector } from "./ScoreInspector";
import { SubAgentLanes } from "./SubAgentLanes";
import { WeaveEvidencePanel } from "./WeaveEvidencePanel";

function firstCaseFor(round: ReplayRound): ReplayCase {
  return round.cases[0];
}

function describeCase(item: ReplayCase): string {
  const outcome = item.breach
    ? "breach"
    : item.falsePositive
      ? "false positive"
      : "expected behavior";
  return `${item.laneLabel} against ${item.targetUser}: expected ${item.expectedDecision}, actual ${item.actualDecision}, outcome ${outcome}.`;
}

export function Dashboard() {
  const [selectedRoundId, setSelectedRoundId] = useState("attack_round_1");
  const [selectedLane, setSelectedLane] = useState("prompt_injection");

  const summary = useMemo(() => getReplaySummary(replayRounds), []);
  const selectedRound =
    replayRounds.find((round) => round.id === selectedRoundId) ?? replayRounds[0];
  const selectedCase = getSelectedCase(replayRounds, selectedRound.id, selectedLane);

  function selectRound(roundId: string) {
    const nextRound = replayRounds.find((round) => round.id === roundId);
    if (!nextRound) return `Unknown round: ${roundId}`;
    const nextCase = firstCaseFor(nextRound);
    setSelectedRoundId(nextRound.id);
    setSelectedLane(nextCase.lane);
    return `Selected ${nextRound.title}. ${nextRound.narrative}`;
  }

  function selectCase(roundId: string, lane: string) {
    const item = getSelectedCase(replayRounds, roundId, lane);
    setSelectedRoundId(roundId);
    setSelectedLane(lane);
    return describeCase(item);
  }

  return (
    <main className="dashboard-shell">
      <section className="hero">
        <div>
          <h1>Loan Agent Red-Team</h1>
        </div>
        <div className="summary-grid" aria-label="Replay summary">
          <SummaryCard label="Rounds" value={summary.totalRounds.toString()} />
          <SummaryCard label="Breaches found" value={summary.attackBreaches.toString()} tone="danger" />
          <SummaryCard label="False positives" value={summary.falsePositives.toString()} tone="warning" />
          <SummaryCard label="Final status" value="Blocked + preserved" tone="success" />
        </div>
      </section>

      <AttackTimeline
        rounds={replayRounds}
        selectedRoundId={selectedRound.id}
        onSelectRound={selectRound}
      />

      <section className="main-grid">
        <SubAgentLanes
          round={selectedRound}
          selectedCaseId={selectedCase.id}
          onSelectCase={(item) => selectCase(selectedRound.id, item.lane)}
        />
        <ScoreInspector selectedCase={selectedCase} />
      </section>

      <section className="support-grid">
        <RegressionMatrix rounds={replayRounds} selectedCaseId={selectedCase.id} onSelectCase={selectCase} />
        <WeaveEvidencePanel selectedCase={selectedCase} />
      </section>
    </main>
  );
}

type SummaryCardProps = {
  label: string;
  value: string;
  tone?: "neutral" | "danger" | "success" | "warning";
};

function SummaryCard({ label, value, tone = "neutral" }: SummaryCardProps) {
  return (
    <div className={`summary-card summary-card-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
