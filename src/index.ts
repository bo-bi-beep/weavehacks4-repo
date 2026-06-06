import "dotenv/config";
import { OpenAI } from "openai";

import { getOpenAIModel, getWeaveProjectName, initWeave, requireEnv, weave } from "./lib/weave.js";

const brainstormHackathonAngle = weave.op(async function brainstormHackathonAngle(problem: string) {
  // The current Weave npm typings lag the latest OpenAI SDK typings a bit,
  // so we cast through `any` here while still using the real wrapped client at runtime.
  const client = weave.wrapOpenAI(
    new OpenAI({
      apiKey: requireEnv("OPENAI_API_KEY"),
    }) as any,
  ) as OpenAI;

  const response = await client.chat.completions.create({
    model: getOpenAIModel(),
    messages: [
      {
        role: "system",
        content:
          "You are a sharp hackathon copilot. Return a concise answer with four sections: problem, user, demo, and first milestone.",
      },
      {
        role: "user",
        content: problem,
      },
    ],
  });

  return response.choices[0]?.message?.content ?? "";
});

const prompt =
  process.argv.slice(2).join(" ").trim() ||
  "Help solo hackers turn messy AI ideas into a clear 48-hour demo with visible agent traces.";

const tracing = await initWeave();

console.log(
  tracing
    ? `Tracing to W&B Weave project: ${getWeaveProjectName()}`
    : "Weave tracing disabled (set WANDB_API_KEY to enable).",
);
console.log();
console.log(await brainstormHackathonAngle(prompt));
