import "dotenv/config";

import { closeDefaultAttackKbStorageAdapter } from "../storage/index.js";
import { buildAttackKbMainAgentDemoFlow } from "./flow.js";
import { createAttackKbDemoServer } from "./server.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

async function request<T>(baseUrl: string, path: string): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`);
  const body = (await response.json()) as T & { error?: string };

  if (!response.ok || body.error) {
    throw new Error(body.error ?? `HTTP ${response.status}`);
  }

  return body;
}

const flow = await buildAttackKbMainAgentDemoFlow();
assert(flow.steps.probingResponse.phase === "probing", "Expected demo probing phase.");
assert(flow.steps.attackResponse.phase === "attack", "Expected demo attack phase.");
assert(flow.steps.attackResponse.recommendations.some((rec) => rec.composition), "Expected composed recommendation.");
assert(flow.steps.deliverySubagentTasks.length > 0, "Expected delivery subagent tasks.");
assert(flow.boundary.includes("never contacts the Agent Under Test"), "Expected no-direct-AUT boundary.");

const server = createAttackKbDemoServer();
await new Promise<void>((resolve) => server.listen(0, resolve));
const address = server.address();
assert(address && typeof address === "object", "Expected server TCP address.");
const baseUrl = `http://127.0.0.1:${address.port}`;

try {
  const health = await request<{ ok: boolean }>(baseUrl, "/api/health");
  assert(health.ok, "Expected health endpoint to pass.");

  const apiFlow = await request<typeof flow>(baseUrl, "/api/demo");
  assert(apiFlow.steps.probingResponse.phase === "probing", "Expected API probing phase.");
  assert(apiFlow.steps.attackResponse.phase === "attack", "Expected API attack phase.");

  console.log(
    JSON.stringify(
      {
        ok: true,
        message: "Attack KB main-agent demo smoke passed.",
        baseUrl,
        traceState: apiFlow.traceState,
        weaveProject: apiFlow.weaveProject,
        probingRecommendations: apiFlow.steps.probingResponse.recommendations.length,
        attackRecommendations: apiFlow.steps.attackResponse.recommendations.length,
        deliverySubagentTasks: apiFlow.steps.deliverySubagentTasks.length,
      },
      null,
      2,
    ),
  );
} finally {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    }),
  );
  await closeDefaultAttackKbStorageAdapter();
}
