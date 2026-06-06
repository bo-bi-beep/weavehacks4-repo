import "dotenv/config";
import { pathToFileURL } from "node:url";

import { run } from "@openai/agents";
import { Manifest, SandboxAgent, file, shell } from "@openai/agents/sandbox";

import { createBlaxelSandboxClient } from "../../src/lib/blaxel.js";
import {
  getOpenAIModel,
  getWeaveProjectName,
  initWeave,
  requireEnv,
  weave,
} from "../../src/lib/weave.js";

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

// Weave-traced entry point so the full sandbox run is visible in the demo trace.
// The compute now runs on a Blaxel sandbox (instant-launch micro-VM) instead of
// a local Unix process; the runner creates the session from `defaultManifest`
// and tears it down when the run finishes.
export const runMainAgent = weave.op(async function runMainAgent(prompt: string) {
  const result = await run(mainAgent, prompt, {
    sandbox: {
      client: createBlaxelSandboxClient(),
    },
  });

  return result.finalOutput ?? "";
});

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
