import * as weave from "weave";

export function getWeaveProjectName(): string {
  const project = process.env.WANDB_PROJECT?.trim() || "fix-agent";
  const entity = process.env.WANDB_ENTITY?.trim();
  return entity ? `${entity}/${project}` : project;
}

export function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

let initialized = false;
let weaveEnabled = false;

export function isWeaveEnabled(): boolean {
  return weaveEnabled;
}

export async function initWeave(): Promise<boolean> {
  if (initialized) return weaveEnabled;
  initialized = true;

  const apiKey = process.env.WANDB_API_KEY?.trim();
  if (!apiKey) {
    console.warn("[weave] WANDB_API_KEY not set — skipping Weave tracing.");
    return false;
  }

  await weave.init(getWeaveProjectName());
  weaveEnabled = true;
  return true;
}

export { weave };
