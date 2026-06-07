import { setTraceProcessors } from "@openai/agents";
import * as weave from "weave";

export function getWeaveProjectName(): string {
  const project = process.env.WANDB_PROJECT?.trim() || "weavehacks4-your-idea";
  const entity = process.env.WANDB_ENTITY?.trim();
  return entity ? `${entity}/${project}` : project;
}

export function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function getOpenAIModel(): string {
  return process.env.OPENAI_MODEL?.trim() || "gpt-5.4-mini";
}

/**
 * Model for the orchestrating Main Agent. It runs on a stronger model than the
 * sub-agents (which use {@link getOpenAIModel}), so it has its own knob:
 * `MAIN_AGENT_MODEL`, defaulting to OpenAI GPT-5.5.
 */
export function getMainAgentModel(): string {
  return process.env.MAIN_AGENT_MODEL?.trim() || "gpt-5.5";
}

let initialized = false;
let weaveEnabled = false;

/** Whether Weave tracing was successfully initialized in this process. */
export function isWeaveEnabled(): boolean {
  return weaveEnabled;
}

/**
 * Initializes Weave tracing when `WANDB_API_KEY` is set. If the key is absent,
 * tracing is skipped with a warning instead of throwing, so flows can still run
 * without a W&B account. Returns whether tracing is enabled.
 */
export async function initWeave(): Promise<boolean> {
  if (initialized) {
    return weaveEnabled;
  }
  initialized = true;

  const apiKey = process.env.WANDB_API_KEY?.trim();
  if (!apiKey) {
    console.warn(
      "[weave] WANDB_API_KEY not set — skipping Weave tracing. " +
        "Add it to .env to enable traces (get one at https://wandb.ai/authorize).",
    );
    return false;
  }

  await weave.init(getWeaveProjectName());

  // Bridge the OpenAI Agents SDK's spans into Weave so every agent run, LLM
  // generation, and tool call shows up as a nested span — including each
  // `sandbox.exec` shell command run in the Blaxel/Unix sandbox (the SDK wraps
  // every `exec_command` in a trace span). `setTraceProcessors` makes Weave the
  // sole destination, replacing the SDK default that would otherwise export
  // traces to OpenAI's backend.
  setTraceProcessors([weave.createOpenAIAgentsTracingProcessor()]);

  weaveEnabled = true;
  return true;
}

export { weave };
