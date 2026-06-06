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
import { SubAgentService } from "../sub_agents/service.js";
import { createSubAgentTools } from "./sub_agent_tools.js";

// Registry of sandboxed sub-agents the main agent can spawn at runtime. It runs
// in this (harness) process and gives each sub-agent its own Blaxel micro-VM —
// the same service `agents/sub_agents` exposes over HTTP. Exposed to the model
// as function tools below, so the main agent acts as an orchestrator that can
// fan a task out across a dynamic number of sub-agents.
const subAgents = new SubAgentService();

// Seed the sandbox workspace. The agent reads, writes, and runs shell commands
// against these files inside an isolated Unix-like environment. The default
// task is a small fan-out demo: independent items the agent can hand to one
// sub-agent each, then synthesize.
const manifest = new Manifest({
  entries: {
    "task.md": file({
      content:
        "# Task\n\n" +
        "You are an orchestrator. Spawn one sub-agent per item below, ask each " +
        "to compute just its own result, then report all results together.\n\n" +
        "- 1 + 25\n" +
        "- 7 * 6\n" +
        "- the number of letters in the word \"weave\"\n",
    }),
  },
});

// The Sandbox Agent: a model with shell access to an isolated workspace, plus
// tools to spawn and delegate to sub-agents. Exported so orchestration code can
// reuse it. Function tools (sub-agent control) run in this process; the shell
// capability runs in the sandbox — the SDK merges both into the agent's tools.
// See https://developers.openai.com/api/docs/guides/agents/sandboxes
export const mainAgent = new SandboxAgent({
  name: "Main Agent",
  model: getOpenAIModel(),
  instructions:
    "You are the main orchestrator agent. You have your own sandbox workspace " +
    "(inspect it with the shell) plus tools to spawn and delegate to sandboxed " +
    "sub-agents.\n\n" +
    "When a task has independent parts, break it down and spawn one sub-agent " +
    "per part with `spawn_sub_agent` — spawn as many as the work needs. " +
    "Delegate each part with `ask_sub_agent`, optionally preloading repo skills " +
    "or running shell commands inside a sub-agent's sandbox. Collect the " +
    "sub-agents' replies and synthesize a single final answer. Keep responses " +
    "concise and cite the files or sub-agents you relied on.",
  defaultManifest: manifest,
  capabilities: [shell()],
  tools: createSubAgentTools(subAgents),
});

// Weave-traced sandbox run so the full run is visible in the demo trace. The
// compute runs on a Blaxel sandbox (instant-launch micro-VM) instead of a local
// Unix process; the runner creates the session from `defaultManifest` and tears
// it down when the run finishes. `weave.op` only records a span once Weave has
// been initialized, which `runMainAgent` below guarantees before calling this.
const runMainAgentTraced = weave.op(async function runMainAgent(prompt: string) {
  try {
    const result = await run(mainAgent, prompt, {
      sandbox: {
        client: createBlaxelSandboxClient(),
      },
    });

    return result.finalOutput ?? "";
  } finally {
    // Tear down any sub-agent micro-VMs the run spawned so none leak past it.
    await subAgents.closeAll();
  }
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
