import { spawn } from "node:child_process";

import type { AttackKbStorageObjectType } from "../types.js";

export type AttackKbContextRetrieverMode = "disabled" | "auto";

export type AttackKbContextRetrieverConfig = {
  mode: AttackKbContextRetrieverMode;
  agentKey?: string;
  timeoutMs: number;
  maxCalls: number;
};

export type AttackKbContextRetrieverToolResult = {
  toolName?: string;
  status: "hydrated" | "unsupported" | "unconfigured" | "error";
  result?: unknown;
  error?: string;
};

export type AttackKbContextRetrieverArtifactInput = {
  id: string;
  objectType: AttackKbStorageObjectType;
};

const TOOL_BY_OBJECT_TYPE: Partial<Record<AttackKbStorageObjectType, string>> = {
  attack_pattern: "get_attackpattern_by_id",
  delivery_mode: "get_deliverymode_by_id",
  evidence_source: "get_evidencesource_by_id",
  payload_template: "get_attackroutetemplate_by_id",
  success_signal: "get_successsignal_by_id",
  system_attack_pattern: "get_systempattern_by_id",
  vulnerability: "get_vulnerability_by_id",
};

function env(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function parseMode(value: string | undefined): AttackKbContextRetrieverMode {
  const normalized = value?.toLowerCase() || "auto";
  if (["disabled", "off", "false", "0", "none"].includes(normalized)) {
    return "disabled";
  }
  return "auto";
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function getAttackKbContextRetrieverConfig(): AttackKbContextRetrieverConfig {
  return {
    mode: parseMode(env("ATTACK_KB_CONTEXT_RETRIEVER")),
    agentKey: env("MCP_AGENT_KEY"),
    timeoutMs: parsePositiveInteger(env("ATTACK_KB_CONTEXT_RETRIEVER_TIMEOUT_MS"), 12_000),
    maxCalls: parsePositiveInteger(env("ATTACK_KB_CONTEXT_RETRIEVER_MAX_CALLS"), 8),
  };
}

export function contextRetrieverToolForObjectType(objectType: AttackKbStorageObjectType): string | undefined {
  return TOOL_BY_OBJECT_TYPE[objectType];
}

function parseContextToolResult(value: unknown): unknown {
  if (!value || typeof value !== "object") {
    return value;
  }

  const content = (value as { content?: unknown }).content;
  if (!Array.isArray(content)) {
    return value;
  }

  const first = content[0];
  if (!first || typeof first !== "object") {
    return value;
  }

  const text = (first as { text?: unknown }).text;
  if (typeof text !== "string") {
    return value;
  }

  try {
    return JSON.parse(text);
  } catch {
    return { rawText: text };
  }
}

function asErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

type BatchContextRetrieverInput = {
  agentKey: string;
  items: Array<{
    id: string;
    objectType: AttackKbStorageObjectType;
    toolName: string;
  }>;
};

type BatchContextRetrieverOutput = Array<{
  id: string;
  objectType: AttackKbStorageObjectType;
  toolName?: string;
  status: "hydrated" | "error";
  result?: unknown;
  error?: string;
}>;

function runContextRetrieverPythonBatch(
  input: BatchContextRetrieverInput,
  timeoutMs: number,
): Promise<BatchContextRetrieverOutput> {
  const script = String.raw`
import asyncio
import json
import sys
from context_surfaces import UnifiedClient

async def main():
    payload = json.loads(sys.stdin.read())
    results = []
    async with UnifiedClient() as client:
        for item in payload["items"]:
            try:
                result = await client.query_tool(
                    payload["agentKey"],
                    item["toolName"],
                    {"id": item["id"]},
                )
                results.append({
                    "id": item["id"],
                    "objectType": item["objectType"],
                    "toolName": item["toolName"],
                    "status": "hydrated",
                    "result": result,
                })
            except Exception as exc:
                results.append({
                    "id": item["id"],
                    "objectType": item["objectType"],
                    "toolName": item["toolName"],
                    "status": "error",
                    "error": str(exc),
                })
    print(json.dumps(results))

asyncio.run(main())
`;

  return new Promise((resolve, reject) => {
    const child = spawn("uvx", ["--from", "context-surfaces", "python", "-c", script], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`Context Retriever batch timed out after ${timeoutMs}ms.`));
    }, timeoutMs);
    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(stderr.trim() || `Context Retriever batch exited with ${code}.`));
        return;
      }

      try {
        const parsed = JSON.parse(stdout) as BatchContextRetrieverOutput;
        resolve(parsed.map((item) => ({
          ...item,
          result: item.status === "hydrated" ? parseContextToolResult(item.result) : item.result,
        })));
      } catch {
        reject(new Error(`Context Retriever returned non-JSON output: ${stdout.slice(0, 300)}`));
      }
    });
    child.stdin.end(JSON.stringify(input));
  });
}

export async function hydrateContextRetrieverArtifacts(
  inputs: AttackKbContextRetrieverArtifactInput[],
  config: AttackKbContextRetrieverConfig = getAttackKbContextRetrieverConfig(),
): Promise<Map<string, AttackKbContextRetrieverToolResult>> {
  const results = new Map<string, AttackKbContextRetrieverToolResult>();
  const batchItems: BatchContextRetrieverInput["items"] = [];
  let calls = 0;

  for (const input of inputs) {
    const toolName = contextRetrieverToolForObjectType(input.objectType);
    if (!toolName) {
      results.set(input.id, { status: "unsupported" });
      continue;
    }

    if (config.mode === "disabled" || !config.agentKey) {
      results.set(input.id, { toolName, status: "unconfigured" });
      continue;
    }

    if (calls >= config.maxCalls) {
      results.set(input.id, { toolName, status: "unconfigured" });
      continue;
    }

    calls += 1;
    batchItems.push({ id: input.id, objectType: input.objectType, toolName });
  }

  if (batchItems.length === 0 || !config.agentKey) {
    return results;
  }

  try {
    const batchResults = await runContextRetrieverPythonBatch({ agentKey: config.agentKey, items: batchItems }, config.timeoutMs);
    for (const item of batchResults) {
      results.set(item.id, {
        toolName: item.toolName,
        status: item.status,
        result: item.result,
        error: item.error,
      });
    }
  } catch (error) {
    const message = asErrorMessage(error);
    for (const item of batchItems) {
      results.set(item.id, { toolName: item.toolName, status: "error", error: message });
    }
  }

  return results;
}

export async function hydrateContextRetrieverArtifact(
  id: string,
  objectType: AttackKbStorageObjectType,
  config: AttackKbContextRetrieverConfig = getAttackKbContextRetrieverConfig(),
): Promise<AttackKbContextRetrieverToolResult> {
  const hydrated = await hydrateContextRetrieverArtifacts([{ id, objectType }], config);
  return hydrated.get(id) ?? { status: "unsupported" };
}
