import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { run } from "@openai/agents";
import { Manifest, SandboxAgent, file, shell } from "@openai/agents/sandbox";
import { UnixLocalSandboxClient } from "@openai/agents/sandbox/local";

import { getOpenAIModel, weave } from "../../src/lib/weave.js";

// Repo root, used to resolve repo skills (`.claude/skills/<name>/SKILL.md`).
const REPO_ROOT = path.resolve(fileURLToPath(import.meta.url), "../../..");

/** Where loaded skills are mounted inside each sub-agent's sandbox workspace. */
const SKILL_MOUNT = "skills";

/** Directories searched (in order) when resolving a named repo skill. */
const SKILL_SEARCH_DIRS = [".claude/skills", ".agents/skills"];

/** A live sandbox session, as returned by the sandbox client. */
type SandboxSession = Awaited<ReturnType<UnixLocalSandboxClient["create"]>>;

/** Input accepted by {@link SubAgentService.createAgent}. */
export interface CreateAgentInput {
  /** Human-readable name; defaults to `Sub Agent <short id>`. */
  name?: string;
  /** System instructions; a sensible sandbox-aware default is used if omitted. */
  instructions?: string;
  /** Optional task seeded into the workspace as `task.md`. */
  task?: string;
  /** Model override; defaults to {@link getOpenAIModel}. */
  model?: string;
}

/** Public summary of a sub-agent. */
export interface AgentSummary {
  id: string;
  name: string;
  model: string;
  skills: string[];
  turns: number;
}

/** Result of loading a skill into a sub-agent. */
export interface LoadSkillResult {
  ok: true;
  skill: string;
  /** Workspace-relative path where the skill is mounted in the sandbox. */
  sandboxPath: string;
  /** Absolute repo path the skill was read from. */
  sourcePath: string;
  bytes: number;
}

/** Options for {@link SubAgentService.runCommand} (the per-agent terminal). */
export interface RunCommandOptions {
  /** Working directory inside the sandbox (workspace-relative). */
  workdir?: string;
  /** Run as a login shell (sources profile files). */
  login?: boolean;
  /** Override the shell (defaults to the sandbox default). */
  shell?: string;
}

/** Result of running a shell command in a sub-agent's sandbox. */
export interface TerminalResult {
  command: string;
  stdout: string;
  stderr: string;
  /** Combined output as the sandbox reports it. */
  output: string;
  /** Process exit code (`null` if terminated by a signal). */
  exitCode: number | null;
  wallTimeSeconds: number;
}

/**
 * One event emitted while streaming a sub-agent's reply. The HTTP layer renders
 * each as a Server-Sent Event (`event: <type>` / `data: <json>`).
 */
export type AgentStreamEvent =
  | { type: "delta"; text: string }
  | { type: "item"; name: string; itemType?: string }
  | { type: "agent_updated"; agent?: string }
  | { type: "done"; finalOutput: string; turns: number; historyLength: number }
  | { type: "error"; message: string };

interface AgentRecord {
  id: string;
  name: string;
  model: string;
  instructions: string;
  /** Workspace-relative path -> file content. Seeds the session; skills materialize live. */
  manifestEntries: Map<string, string>;
  /** Loaded skill names, in load order. */
  skills: string[];
  /** Running conversation, reused as input on the next turn (see SDK `result.history`). */
  history: unknown[];
  /** Live sandbox session (lazily created); owns the agent's persistent workspace. */
  session: SandboxSession | null;
}

const DEFAULT_INSTRUCTIONS =
  "You are a sub-agent running inside an isolated Unix sandbox. Inspect the " +
  "workspace with the shell before answering. If skills are mounted under " +
  `\`${SKILL_MOUNT}/\`, read the relevant \`SKILL.md\` and follow its guidance. ` +
  "Keep responses concise and cite any files you relied on.";

/**
 * Records a completed sub-agent turn as a Weave op so the prompt and reply are
 * visible in the trace. The streamed model run itself happens inside the OpenAI
 * Agents SDK; this op captures the turn's inputs and output for the demo trace.
 */
const recordTurn = weave.op(async function subAgentTurn(turn: {
  agentId: string;
  agentName: string;
  model: string;
  message: string;
  finalOutput: string;
  items: string[];
}) {
  return turn.finalOutput;
});

/**
 * In-memory registry of OpenAI Sandbox sub-agents.
 *
 * Mirrors `agents/main_agent` (a {@link SandboxAgent} run against a
 * {@link UnixLocalSandboxClient}) but manages many addressable agents and adds:
 *
 * - {@link createAgent} — register a new sandbox sub-agent, return its id.
 * - {@link sendMessage} — stream a reply token-by-token (consumed as SSE).
 * - {@link loadSkill} — mount a repo skill's `SKILL.md` into the agent's workspace.
 * - {@link runCommand} — run a shell command directly in the agent's sandbox.
 *
 * Each agent owns one persistent {@link UnixLocalSandboxClient} session, so its
 * filesystem survives across messages and is shared with the terminal. Chat
 * memory persists via the SDK's `result.history`.
 */
export class SubAgentService {
  private readonly agents = new Map<string, AgentRecord>();
  private readonly client: UnixLocalSandboxClient;

  constructor(client: UnixLocalSandboxClient = new UnixLocalSandboxClient()) {
    this.client = client;
  }

  /** create_agent(): register a sub-agent and return its summary (with `id`). */
  createAgent = weave.op(
    async (input: CreateAgentInput = {}): Promise<AgentSummary> => {
      const id = randomUUID();
      const name = input.name?.trim() || `Sub Agent ${id.slice(0, 8)}`;
      const manifestEntries = new Map<string, string>();

      const task = input.task?.trim();
      if (task) {
        manifestEntries.set("task.md", `# Task\n\n${task}\n`);
      }

      const record: AgentRecord = {
        id,
        name,
        model: input.model?.trim() || getOpenAIModel(),
        instructions: input.instructions?.trim() || DEFAULT_INSTRUCTIONS,
        manifestEntries,
        skills: [],
        history: [],
        session: null,
      };
      this.agents.set(id, record);
      return this.summarize(record);
    },
    { name: "createSubAgent" },
  );

  /**
   * send_message(): stream the sub-agent's reply as {@link AgentStreamEvent}s.
   *
   * The HTTP layer forwards each yielded event as an SSE frame. Conversation
   * history is updated when the turn completes so the next call continues it.
   */
  async *sendMessage(
    agentId: string,
    message: string,
    opts: { signal?: AbortSignal } = {},
  ): AsyncGenerator<AgentStreamEvent> {
    let finalText = "";
    const items: string[] = [];

    try {
      const record = this.requireAgent(agentId);
      const session = await this.ensureSession(record);
      const agent = this.buildAgent(record);

      // First turn: send the raw message. Later turns: replay history + new turn.
      const userItem = { role: "user", content: message } as const;
      const input =
        record.history.length > 0 ? [...record.history, userItem] : [userItem];

      const stream = await run(agent, input as never, {
        sandbox: { session },
        stream: true,
        signal: opts.signal,
      });

      for await (const event of stream as AsyncIterable<any>) {
        if (opts.signal?.aborted) break;

        if (
          event.type === "raw_model_stream_event" &&
          event.data?.type === "output_text_delta"
        ) {
          const delta: string = event.data.delta ?? "";
          if (delta) {
            finalText += delta;
            yield { type: "delta", text: delta };
          }
        } else if (event.type === "run_item_stream_event") {
          const itemType: string | undefined = event.item?.type;
          if (itemType) items.push(itemType);
          yield { type: "item", name: event.name, itemType };
        } else if (event.type === "agent_updated_stream_event") {
          yield { type: "agent_updated", agent: event.agent?.name };
        }
      }

      await stream.completed;

      const finalOutput = (stream.finalOutput as string | undefined) ?? finalText;
      if (Array.isArray(stream.history)) {
        record.history = stream.history as unknown[];
      }

      await recordTurn({
        agentId: record.id,
        agentName: record.name,
        model: record.model,
        message,
        finalOutput,
        items,
      });

      yield {
        type: "done",
        finalOutput,
        turns: this.countAssistantTurns(record.history),
        historyLength: record.history.length,
      };
    } catch (err) {
      yield {
        type: "error",
        message: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * load_skill(): mount a repo skill's `SKILL.md` into the agent's workspace and
   * remind it (via instructions) to consult the skill. Persists across turns.
   */
  loadSkill = weave.op(
    async (agentId: string, skill: string): Promise<LoadSkillResult> => {
      const record = this.requireAgent(agentId);
      const name = skill.trim();
      if (!name || name.includes("..") || path.isAbsolute(name)) {
        throw new Error(`Invalid skill name: ${JSON.stringify(skill)}`);
      }

      const { content, sourcePath } = await this.readSkill(name);
      const sandboxPath = `${SKILL_MOUNT}/${name}/SKILL.md`;
      record.manifestEntries.set(sandboxPath, content);

      if (!record.skills.includes(name)) {
        record.skills.push(name);
        record.instructions +=
          `\n\nYou have loaded the "${name}" skill. Its guidance lives at ` +
          `\`${sandboxPath}\` in your workspace — read it before acting on ` +
          "related tasks.";
      }

      // If the session is already live, surface the skill file immediately so
      // both the agent and the terminal see it without a restart.
      if (record.session?.materializeEntry) {
        await record.session.materializeEntry({
          path: sandboxPath,
          entry: file({ content }),
        });
      }

      return {
        ok: true,
        skill: name,
        sandboxPath,
        sourcePath,
        bytes: Buffer.byteLength(content, "utf8"),
      };
    },
    { name: "loadSkill" },
  );

  /**
   * terminal: run a shell command directly in a specific sub-agent's sandbox.
   *
   * Bypasses the model — this is a raw shell into the same persistent workspace
   * the agent reads and writes via {@link sendMessage}. Returns stdout, stderr,
   * and the exit code.
   */
  runCommand = weave.op(
    async (
      agentId: string,
      command: string,
      opts: RunCommandOptions = {},
    ): Promise<TerminalResult> => {
      const record = this.requireAgent(agentId);
      const session = await this.ensureSession(record);
      if (typeof session.exec !== "function") {
        throw new Error(
          "This sandbox session does not support command execution",
        );
      }

      const result = await session.exec({
        cmd: command,
        workdir: opts.workdir,
        shell: opts.shell,
        login: opts.login,
      });

      return {
        command,
        stdout: result.stdout,
        stderr: result.stderr,
        output: result.output,
        exitCode: result.exitCode ?? null,
        wallTimeSeconds: result.wallTimeSeconds,
      };
    },
    { name: "subAgentTerminal" },
  );

  /** Returns a summary for every registered agent. */
  listAgents(): AgentSummary[] {
    return [...this.agents.values()].map((record) => this.summarize(record));
  }

  /** Returns the summary for one agent, or `undefined` if unknown. */
  getAgent(agentId: string): AgentSummary | undefined {
    const record = this.agents.get(agentId);
    return record ? this.summarize(record) : undefined;
  }

  /** Removes an agent and tears down its sandbox session. */
  async deleteAgent(agentId: string): Promise<boolean> {
    const record = this.agents.get(agentId);
    if (!record) return false;
    await this.closeSession(record);
    return this.agents.delete(agentId);
  }

  /** Closes every agent's sandbox session. Call on server shutdown. */
  async closeAll(): Promise<void> {
    await Promise.all(
      [...this.agents.values()].map((record) => this.closeSession(record)),
    );
  }

  // --- internals -----------------------------------------------------------

  private buildAgent(record: AgentRecord): SandboxAgent {
    // The workspace is supplied by the agent's live session, so no manifest is
    // attached here — only instructions and capabilities vary per turn.
    return new SandboxAgent({
      name: record.name,
      model: record.model,
      instructions: record.instructions,
      capabilities: [shell()],
    });
  }

  /** Builds a {@link Manifest} that seeds a session from accumulated entries. */
  private buildManifest(record: AgentRecord): Manifest {
    const entries: Record<string, ReturnType<typeof file>> = {};
    for (const [entryPath, content] of record.manifestEntries) {
      entries[entryPath] = file({ content });
    }
    return new Manifest({ entries });
  }

  /** Lazily creates (and caches) the agent's live sandbox session. */
  private async ensureSession(record: AgentRecord): Promise<SandboxSession> {
    if (!record.session) {
      record.session = await this.client.create(this.buildManifest(record));
    }
    return record.session;
  }

  /** Best-effort teardown of an agent's session and its workspace. */
  private async closeSession(record: AgentRecord): Promise<void> {
    const session = record.session;
    record.session = null;
    if (!session) return;
    try {
      await (session.delete?.() ?? session.close?.());
    } catch {
      // Best-effort cleanup; the workspace lives under a temp dir.
    }
  }

  private async readSkill(
    name: string,
  ): Promise<{ content: string; sourcePath: string }> {
    for (const dir of SKILL_SEARCH_DIRS) {
      const sourcePath = path.join(REPO_ROOT, dir, name, "SKILL.md");
      try {
        const content = await readFile(sourcePath, "utf8");
        return { content, sourcePath };
      } catch {
        // Try the next search directory.
      }
    }
    throw new Error(
      `Skill "${name}" not found. Looked in: ` +
        SKILL_SEARCH_DIRS.map((d) => `${d}/${name}/SKILL.md`).join(", "),
    );
  }

  private requireAgent(agentId: string): AgentRecord {
    const record = this.agents.get(agentId);
    if (!record) {
      throw new Error(`Unknown agent: ${agentId}`);
    }
    return record;
  }

  private summarize(record: AgentRecord): AgentSummary {
    return {
      id: record.id,
      name: record.name,
      model: record.model,
      skills: [...record.skills],
      turns: this.countAssistantTurns(record.history),
    };
  }

  private countAssistantTurns(history: unknown[]): number {
    return history.filter(
      (item) =>
        typeof item === "object" &&
        item !== null &&
        (item as { role?: string }).role === "assistant",
    ).length;
  }
}
