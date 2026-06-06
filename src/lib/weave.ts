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
  return process.env.OPENAI_MODEL?.trim() || "gpt-4.1-mini";
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
  weaveEnabled = true;
  return true;
}

export { weave };
