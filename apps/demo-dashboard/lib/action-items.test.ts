import assert from "node:assert/strict";
import { test } from "node:test";

import {
  actionItems,
  applyActionItemFix,
  filterVulnerabilities,
  getActionPanelSummary,
  sortVulnerabilities,
  vulnerabilities,
} from "./action-items";

test("action panel summary prioritizes open work and real breaches", () => {
  const summary = getActionPanelSummary(actionItems, vulnerabilities);

  assert.equal(summary.openActionItems, 4);
  assert.equal(summary.fixedActionItems, 1);
  assert.equal(summary.criticalVulnerabilities, 1);
  assert.equal(summary.realTraceVulnerabilities, vulnerabilities.length);
});

test("vulnerabilities can be filtered by attack family and source", () => {
  const filtered = filterVulnerabilities(vulnerabilities, {
    attackFamily: "data_manipulation",
    source: "real_weave_trace",
  });

  assert.deepEqual(
    filtered.map((item) => item.id),
    ["ashley-extreme-asset-update"],
  );
});

test("vulnerabilities sort by severity before lower-priority findings", () => {
  const sorted = sortVulnerabilities(vulnerabilities, "severity");

  assert.equal(sorted[0].id, "ashley-extreme-asset-update");
  assert.equal(sorted.at(-1)?.severity, "low");
});

test("fixing an action item updates only the selected action state", () => {
  const nextItems = applyActionItemFix(actionItems, "lock-immutable-borrower-fields");
  const fixed = nextItems.find((item) => item.id === "lock-immutable-borrower-fields");
  const untouched = nextItems.find((item) => item.id === "review-score-thresholds");

  assert.equal(fixed?.status, "fixed");
  assert.equal(untouched?.status, "open");
  assert.notEqual(nextItems, actionItems);
  assert.equal(actionItems.find((item) => item.id === "lock-immutable-borrower-fields")?.status, "open");
});

test("each vulnerability has a replayable discovery chat", () => {
  for (const finding of vulnerabilities) {
    assert.ok(finding.discoveryChat.length >= 3);
    assert.ok(finding.discoveryChat.some((turn) => turn.role === "attacker"));
    assert.ok(finding.discoveryChat.some((turn) => turn.role === "loan_agent"));
    assert.ok(finding.discoveryChat.some((turn) => turn.role === "trace"));
  }
});
