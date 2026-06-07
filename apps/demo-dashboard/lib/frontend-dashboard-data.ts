import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { ActionItem, Vulnerability } from "./action-items";

export type FrontendDashboardData = {
  actionItems: ActionItem[];
  vulnerabilities: Vulnerability[];
  summary: {
    recordCount: number;
    breachCount: number;
    controlCount: number;
    totalTokens: number;
    avgLatencyMs: number;
    vulnerabilitiesPerMillionTokens: number;
  };
};

type RawFrontendDashboardData = {
  summary: FrontendDashboardData["summary"];
  actionItems: ActionItem[];
  vulnerabilities: Vulnerability[];
};

export function getFrontendDashboardData(): FrontendDashboardData {
  const candidatePaths = [
    join(process.cwd(), "testdata", "frontend-dashboard-data.json"),
    join(process.cwd(), "..", "..", "testdata", "frontend-dashboard-data.json"),
  ];
  const dataPath = candidatePaths.find((candidatePath) => existsSync(candidatePath));

  if (!dataPath) {
    throw new Error("Could not find testdata/frontend-dashboard-data.json");
  }

  const raw = JSON.parse(readFileSync(dataPath, "utf8")) as RawFrontendDashboardData;

  return {
    summary: raw.summary,
    actionItems: raw.actionItems,
    vulnerabilities: raw.vulnerabilities,
  };
}
