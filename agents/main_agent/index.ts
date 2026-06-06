import "dotenv/config";
import { pathToFileURL } from "node:url";

import { run } from "@openai/agents";
import { Manifest, SandboxAgent, file, shell } from "@openai/agents/sandbox";
import {
  BlaxelSandboxClient,
  type BlaxelSandboxClientOptions,
} from "@openai/agents-extensions/sandbox/blaxel";

import {
  getOpenAIModel,
  getWeaveProjectName,
  initWeave,
  requireEnv,
  weave,
} from "../../src/lib/weave.js";

// Build Blaxel sandbox options from the environment. Auth (BL_API_KEY,
// BL_WORKSPACE) is read by the underlying @blaxel/core SDK; the rest tune the
// micro-VM. Anything unset falls back to a Blaxel default.
function getBlaxelSandboxOptions(): BlaxelSandboxClientOptions {
  const options: BlaxelSandboxClientOptions = {
    image: process.env.BLAXEL_SANDBOX_IMAGE?.trim() || "blaxel/base-image",
    memory: Number(process.env.BLAXEL_SANDBOX_MEMORY?.trim()) || 4096,
    // Default to a US West region (Portland). Other options include
    // `eu-lon-1` (EU London) and `us-was-1` (US East). Override via
    // BLAXEL_SANDBOX_REGION.
    region: process.env.BLAXEL_SANDBOX_REGION?.trim() || "us-pdx-1",
  };

  const name = process.env.BLAXEL_SANDBOX_NAME?.trim();
  if (name) options.name = name;

  return options;
}

// Seed the sandbox workspace. The agent reads, writes, and runs shell commands
// against these files inside an isolated Unix-like environment.
const manifest = new Manifest({
  entries: {
    "task.md": file({
      content:
        "# Task\n\n" +
        "Calculate 1 + 25 and report the result.\n",
    }),
  },
});

// The minimalistic Sandbox Agent: a model with shell access to an isolated
// workspace. Exported so sub-agents / orchestration code can reuse it.
// See https://developers.openai.com/api/docs/guides/agents/sandboxes
export const mainAgent = new SandboxAgent({
  name: "Main Agent",
  model: getOpenAIModel(),
  instructions:
    "You are the main agent. Inspect the sandbox workspace with the shell " +
    "before answering. Keep responses concise and cite any files you relied on.",
  defaultManifest: manifest,
  capabilities: [shell()],
});

// Weave-traced sandbox run so the full run is visible in the demo trace. The
// compute runs on a Blaxel sandbox (instant-launch micro-VM) instead of a local
// Unix process; the runner creates the session from `defaultManifest` and tears
// it down when the run finishes. `weave.op` only records a span once Weave has
// been initialized, which `runMainAgent` below guarantees before calling this.
const runMainAgentTraced = weave.op(async function runMainAgent(prompt: string) {
  const result = await run(mainAgent, prompt, {
    sandbox: {
      client: new BlaxelSandboxClient(getBlaxelSandboxOptions()),
    },
  });

  return result.finalOutput ?? "";
});

// Public entry point for the main agent. Initializes Weave first so the run is
// traced whether it is launched from the CLI (`main`) or imported and reused by
// a sub-agent / orchestrator (see this folder's README). `initWeave` is
// idempotent, so calling it here and in `main` is a cheap no-op after the first.
export async function runMainAgent(prompt: string): Promise<string> {
  await initWeave();
  return runMainAgentTraced(prompt);
}

async function main(): Promise<void> {
  requireEnv("OPENAI_API_KEY");
  // Blaxel sandbox auth — consumed by @blaxel/core when the session is created.
  requireEnv("BL_API_KEY");
  requireEnv("BL_WORKSPACE");
  const tracing = await initWeave();

  const prompt =
    process.argv.slice(2).join(" ").trim() ||
    "Read task.md and complete the task it describes.";

  console.log(
    tracing
      ? `Tracing to W&B Weave project: ${getWeaveProjectName()}`
      : "Weave tracing disabled (set WANDB_API_KEY to enable).",
  );
  console.log();
  console.log(await runMainAgent(prompt));
}

// Run only when invoked directly (`tsx agents/main_agent/index.ts`); stay a
// plain module when imported elsewhere.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
