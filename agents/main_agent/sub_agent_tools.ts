import { tool, type Tool } from "@openai/agents";

import type { SubAgentService } from "../sub_agents/service.js";

/**
 * Exposes a {@link SubAgentService} to an orchestrating agent as a set of
 * function tools, so the agent can spawn and delegate to a **dynamic** number of
 * sandboxed sub-agents at runtime.
 *
 * These are plain OpenAI Agents `FunctionTool`s: they execute in the harness
 * process (not in any sandbox). Each one drives the service, which owns one
 * persistent Blaxel micro-VM per sub-agent — the same registry the standalone
 * `agents/sub_agents` HTTP service wraps. Attach the returned array to a
 * `SandboxAgent`'s `tools` and it can fan work out across many sub-agents and
 * collect their results, all within one Weave-traced run.
 *
 * Tool surface (one tool per service capability):
 * - `spawn_sub_agent`   — `createAgent` (+ optional `loadSkill` for each skill)
 * - `ask_sub_agent`     — `sendMessage`, drained to the sub-agent's final reply
 * - `load_skill`        — `loadSkill`
 * - `run_in_sub_agent`  — `runCommand` (raw shell, bypasses the sub-agent's model)
 * - `list_sub_agents`   — `listAgents`
 * - `stop_sub_agent`    — `deleteAgent` (tears down the sub-agent's sandbox)
 */
export function createSubAgentTools(service: SubAgentService): Tool[] {
  const spawnSubAgent = tool({
    name: "spawn_sub_agent",
    description:
      "Create a new sandboxed sub-agent and return its id and summary. Each " +
      "sub-agent runs in its own isolated Unix sandbox with shell access and " +
      "remembers earlier turns. Give it a focused `task` (seeded into its " +
      "workspace as task.md) and optionally preload repo skills by name. Spawn " +
      "as many sub-agents as the work needs — one per independent subtask — then " +
      "delegate to each with `ask_sub_agent`.",
    strict: false,
    parameters: {
      type: "object",
      additionalProperties: true,
      properties: {
        task: {
          type: "string",
          description:
            "The subtask this sub-agent should focus on. Seeded into its " +
            "sandbox workspace as task.md.",
        },
        name: {
          type: "string",
          description: "Optional human-readable name for the sub-agent.",
        },
        instructions: {
          type: "string",
          description:
            "Optional system-instructions override. Defaults to a generic " +
            "sandbox-aware prompt if omitted.",
        },
        skills: {
          type: "array",
          items: { type: "string" },
          description:
            "Optional repo skill names to preload into the sub-agent (e.g. " +
            "\"weave-integration\"). Each skill's SKILL.md is mounted into its " +
            "workspace under skills/<name>/.",
        },
      },
      required: ["task"],
    },
    async execute(input) {
      const { task, name, instructions, skills } = (input ?? {}) as {
        task?: string;
        name?: string;
        instructions?: string;
        skills?: string[];
      };

      const summary = await service.createAgent({ task, name, instructions });

      const loaded: string[] = [];
      const skillErrors: string[] = [];
      for (const skill of skills ?? []) {
        try {
          await service.loadSkill(summary.id, skill);
          loaded.push(skill);
        } catch (err) {
          skillErrors.push(`${skill}: ${errMessage(err)}`);
        }
      }

      return JSON.stringify({
        ...summary,
        skills: loaded,
        ...(skillErrors.length ? { skillErrors } : {}),
      });
    },
  });

  const askSubAgent = tool({
    name: "ask_sub_agent",
    description:
      "Send a message to an existing sub-agent (by id) and return its full " +
      "reply. The sub-agent inspects its sandbox, may run shell commands, and " +
      "continues the same conversation across calls. Use this to delegate a " +
      "subtask and collect the result.",
    strict: false,
    parameters: {
      type: "object",
      additionalProperties: true,
      properties: {
        agentId: {
          type: "string",
          description: "The sub-agent id returned by spawn_sub_agent.",
        },
        message: {
          type: "string",
          description: "The instruction or question for the sub-agent.",
        },
      },
      required: ["agentId", "message"],
    },
    async execute(input) {
      const { agentId, message } = (input ?? {}) as {
        agentId?: string;
        message?: string;
      };
      if (!agentId || !message) {
        throw new Error("ask_sub_agent requires both `agentId` and `message`.");
      }

      let finalOutput = "";
      for await (const event of service.sendMessage(agentId, message)) {
        if (event.type === "done") finalOutput = event.finalOutput;
        else if (event.type === "error") throw new Error(event.message);
      }
      return finalOutput || "(sub-agent returned no output)";
    },
  });

  const loadSkill = tool({
    name: "load_skill",
    description:
      "Mount a repo skill's SKILL.md into a sub-agent's sandbox and nudge it to " +
      "consult the skill. Useful when a delegated subtask needs guidance the " +
      "sub-agent was not spawned with.",
    strict: false,
    parameters: {
      type: "object",
      additionalProperties: true,
      properties: {
        agentId: {
          type: "string",
          description: "The sub-agent id returned by spawn_sub_agent.",
        },
        skill: {
          type: "string",
          description:
            "Repo skill name to load (resolved from .claude/skills then " +
            ".agents/skills).",
        },
      },
      required: ["agentId", "skill"],
    },
    async execute(input) {
      const { agentId, skill } = (input ?? {}) as {
        agentId?: string;
        skill?: string;
      };
      if (!agentId || !skill) {
        throw new Error("load_skill requires both `agentId` and `skill`.");
      }
      const result = await service.loadSkill(agentId, skill);
      return JSON.stringify(result);
    },
  });

  const runInSubAgent = tool({
    name: "run_in_sub_agent",
    description:
      "Run a shell command directly in a sub-agent's sandbox, bypassing its " +
      "model. Returns stdout/stderr and the exit code. Use this to inspect or " +
      "set up a sub-agent's workspace without spending a model turn.",
    strict: false,
    parameters: {
      type: "object",
      additionalProperties: true,
      properties: {
        agentId: {
          type: "string",
          description: "The sub-agent id returned by spawn_sub_agent.",
        },
        command: {
          type: "string",
          description: "The shell command to run in the sub-agent's sandbox.",
        },
        workdir: {
          type: "string",
          description: "Optional workspace-relative working directory.",
        },
      },
      required: ["agentId", "command"],
    },
    async execute(input) {
      const { agentId, command, workdir } = (input ?? {}) as {
        agentId?: string;
        command?: string;
        workdir?: string;
      };
      if (!agentId || !command) {
        throw new Error("run_in_sub_agent requires both `agentId` and `command`.");
      }
      const result = await service.runCommand(agentId, command, { workdir });
      return JSON.stringify(result);
    },
  });

  const listSubAgents = tool({
    name: "list_sub_agents",
    description:
      "List every sub-agent spawned so far, with its id, name, model, loaded " +
      "skills, and turn count. Use this to recover ids or check progress.",
    strict: false,
    parameters: {
      type: "object",
      additionalProperties: true,
      properties: {},
      required: [],
    },
    async execute() {
      return JSON.stringify(service.listAgents());
    },
  });

  const stopSubAgent = tool({
    name: "stop_sub_agent",
    description:
      "Remove a sub-agent and tear down its sandbox once you are done with it, " +
      "freeing its micro-VM. Optional — all sub-agents are cleaned up when the " +
      "run ends.",
    strict: false,
    parameters: {
      type: "object",
      additionalProperties: true,
      properties: {
        agentId: {
          type: "string",
          description: "The sub-agent id to stop.",
        },
      },
      required: ["agentId"],
    },
    async execute(input) {
      const { agentId } = (input ?? {}) as { agentId?: string };
      if (!agentId) throw new Error("stop_sub_agent requires `agentId`.");
      const stopped = await service.deleteAgent(agentId);
      return JSON.stringify({ ok: stopped, agentId });
    },
  });

  return [
    spawnSubAgent,
    askSubAgent,
    loadSkill,
    runInSubAgent,
    listSubAgents,
    stopSubAgent,
  ];
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
