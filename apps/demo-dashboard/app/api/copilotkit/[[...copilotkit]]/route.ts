import {
  BuiltInAgent,
  CopilotRuntime,
  createCopilotRuntimeHandler,
} from "@copilotkit/runtime/v2";
import type { NextRequest } from "next/server";

const runtime = new CopilotRuntime({
  agents: {
    default: new BuiltInAgent({
      model: process.env.COPILOT_MODEL ?? process.env.OPENAI_MODEL ?? "openai/gpt-4o-mini",
      prompt:
        "You are the presenter copilot for a hackathon demo dashboard. " +
        "Help explain Weave trace evidence, attack rounds, regression failures, " +
        "and loan-agent score calculations. Prefer concise, stage-friendly answers.",
    }),
  },
});

const handler = createCopilotRuntimeHandler({
  runtime,
  basePath: "/api/copilotkit",
});

export async function POST(request: NextRequest) {
  return handler(request);
}

export async function GET(request: NextRequest) {
  return handler(request);
}
