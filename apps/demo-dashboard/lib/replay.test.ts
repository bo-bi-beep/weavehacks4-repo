import assert from "node:assert/strict";
import { test } from "node:test";

import { getReplaySummary, getSelectedCase, replayRounds } from "./replay";

test("replay summary counts attack breaches and regression false positives", () => {
  const summary = getReplaySummary(replayRounds);

  assert.equal(summary.totalRounds, 4);
  assert.equal(summary.attackBreaches, 1);
  assert.equal(summary.falsePositives, 1);
  assert.equal(summary.finalRoundId, "patch_2_final");
});

test("selected case exposes score evidence and weave link", () => {
  const selected = getSelectedCase(replayRounds, "attack_round_1", "prompt_injection");

  assert.equal(selected.targetUser, "dave");
  assert.equal(selected.expectedDecision, "deny");
  assert.equal(selected.actualDecision, "approve");
  assert.equal(selected.scoreEvidence.valuesUsedByScore.annual_income, 185000);
  assert.ok(selected.weave.url.includes("wandb.ai"));
});
