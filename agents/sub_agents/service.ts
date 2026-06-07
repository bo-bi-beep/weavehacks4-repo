import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { run } from "@openai/agents";
import {
  Manifest,
  SandboxAgent,
  file,
  shell,
  type ExecCommandArgs,
  type SandboxSession,
} from "@openai/agents/sandbox";

import { BlaxelSandboxClient, createBlaxelSandboxClient } from "../../src/lib/blaxel.js";
import { getOpenAIModel, weave } from "../../src/lib/weave.js";
import {
  InMemorySubAgentStore,
  type PersistedAgentRecord,
  type SubAgentStore,
} from "./store.js";

// Repo root, used to resolve repo skills (`.claude/skills/<name>/SKILL.md`).
const REPO_ROOT = path.resolve(fileURLToPath(import.meta.url), "../../..");

/** Where loaded skills are mounted inside each sub-agent's sandbox workspace. */
const SKILL_MOUNT = "skills";

/** Directories searched (in order) when resolving a named repo skill. */
const SKILL_SEARCH_DIRS = [".claude/skills", ".agents/skills"];

/** A live sandbox session, as returned by the sandbox client. */
type SandboxSessionHandle = SandboxSession;

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

// An agent's serializable state lives in a SubAgentStore as a
// PersistedAgentRecord (see store.ts); its live Blaxel session is held
// separately, per-process, in `liveSessions` below.

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
 * Derives a unique, stable Blaxel sandbox name for an agent. Honors
 * `BLAXEL_SANDBOX_NAME` as a prefix (so a deployment can group its sandboxes)
 * while still giving each agent its own micro-VM. Blaxel names must be DNS-like;
 * agent ids are UUIDs (lowercase hex + hyphens), which already satisfy that.
 */
function sandboxNameFor(agentId: string): string {
  const prefix = process.env.BLAXEL_SANDBOX_NAME?.trim() || "sub-agent";
  return `${prefix}-${agentId}`;
}

/** Result of running a command in a session, minus the echoed `command`. */
type ExecOutcome = Omit<TerminalResult, "command">;

/**
 * Runs a command in a sandbox session, normalizing across backends.
 *
 * The local Unix sandbox exposes a structured `exec()` (separate stdout/stderr
 * and an exit code). The Blaxel remote session only exposes `execCommand()`,
 * which returns one formatted string, so we parse the header it emits to recover
 * the exit code and wall time and surface the combined output as `stdout`.
 */
async function execInSession(
  session: SandboxSessionHandle,
  args: ExecCommandArgs,
): Promise<ExecOutcome> {
  if (typeof session.exec === "function") {
    const result = await session.exec(args);
    return {
      stdout: result.stdout,
      stderr: result.stderr,
      output: result.output,
      exitCode: result.exitCode ?? null,
      wallTimeSeconds: result.wallTimeSeconds,
    };
  }

  if (typeof session.execCommand === "function") {
    const formatted = await session.execCommand(args);
    const { body, exitCode, wallTimeSeconds } = parseExecCommand(formatted);
    return {
      stdout: body,
      stderr: "",
      output: body,
      exitCode,
      wallTimeSeconds,
    };
  }

  throw new Error("This sandbox session does not support command execution");
}

/**
 * Best-effort parse of the string `execCommand()` returns. The SDK formats it
 * as a small header (`Wall time: ...`, `Process exited with code ...`) followed
 * by `Output:` and the combined output. If the shape ever changes we fall back
 * to returning the whole string as the body with an unknown exit code.
 */
function parseExecCommand(formatted: string): {
  body: string;
  exitCode: number | null;
  wallTimeSeconds: number;
} {
  const marker = "\nOutput:\n";
  const idx = formatted.indexOf(marker);
  if (idx === -1) {
    return { body: formatted, exitCode: null, wallTimeSeconds: 0 };
  }
  const header = formatted.slice(0, idx);
  const body = formatted.slice(idx + marker.length);
  const exit = /Process exited with code (-?\d+)/.exec(header);
  const wall = /Wall time: ([\d.]+) seconds/.exec(header);
  return {
    body,
    exitCode: exit ? Number(exit[1]) : null,
    wallTimeSeconds: wall ? Number(wall[1]) : 0,
  };
}

/**
 * In-memory registry of OpenAI Sandbox sub-agents.
 *
 * Mirrors `agents/main_agent` (a {@link SandboxAgent} run against a
 * {@link BlaxelSandboxClient}) but manages many addressable agents and adds:
 *
 * - {@link createAgent} — register a new sandbox sub-agent, return its id.
 * - {@link sendMessage} — stream a reply token-by-token (consumed as SSE).
 * - {@link loadSkill} — mount a repo skill's `SKILL.md` into the agent's workspace.
 * - {@link runCommand} — run a shell command directly in the agent's sandbox.
 *
 * Like `main_agent`, the compute runs on a **Blaxel** micro-VM. Each agent owns
 * one persistent Blaxel sandbox session (a uniquely named micro-VM), so its
 * filesystem survives across messages and is shared with the terminal. Chat
 * memory persists via the SDK's `result.history`.
 *
 * Agent records are kept in a {@link SubAgentStore} (in-memory by default, Redis
 * when `REDIS_URL` is set), so identity, skills, and chat memory can survive a
 * restart. The live sandbox session can't be serialized, so it is cached
 * per-process in {@link liveSessions} and re-opened on demand — re-attaching to
 * the agent's named micro-VM when possible, else recreating it from the stored
 * manifest (see {@link openSession}).
 */
export class SubAgentService {
  private readonly client: BlaxelSandboxClient;
  private readonly store: SubAgentStore;
  /** Process-local cache of live sandbox sessions, keyed by agent id. */
  private readonly liveSessions = new Map<string, SandboxSessionHandle>();
  /**
   * Opt-in sandbox **filesystem** continuity across restarts. When true, the
   * service keeps micro-VMs alive on shutdown (detach instead of destroy) and
   * tries to re-attach to them by name on next use. When false (the default), it
   * destroys sandboxes on shutdown and recreates them from the stored manifest
   * on next use — reliable, but un-persisted scratch files are lost.
   *
   * Enable only once you've confirmed the sandbox client can re-attach to an
   * existing VM by name (see {@link tryReattach}); otherwise a kept-alive VM
   * could collide with a recreate. This is independent of *registry* durability,
   * which the store (Redis vs in-memory) controls.
   */
  private readonly reattachSandboxes: boolean;

  constructor(
    opts: {
      client?: BlaxelSandboxClient;
      store?: SubAgentStore;
      reattachSandboxes?: boolean;
    } = {},
  ) {
    this.client = opts.client ?? createBlaxelSandboxClient();
    this.store = opts.store ?? new InMemorySubAgentStore();
    this.reattachSandboxes = opts.reattachSandboxes ?? false;
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

      const record: PersistedAgentRecord = {
        id,
        name,
        model: input.model?.trim() || getOpenAIModel(),
        instructions: input.instructions?.trim() || DEFAULT_INSTRUCTIONS,
        manifestEntries,
        skills: [],
        history: [],
      };
      await this.store.save(record);
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
      const record = await this.requireAgent(agentId);
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
      // Persist the updated conversation so the next turn — even in another
      // process — continues from here.
      await this.store.save(record);

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
      const record = await this.requireAgent(agentId);
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

      // Persist the new manifest/skill/instructions before touching the live
      // session, so a recreate (this process or another) seeds the skill too.
      await this.store.save(record);

      // If the session is already live, surface the skill file immediately so
      // both the agent and the terminal see it without a restart.
      const live = this.liveSessions.get(record.id);
      if (live?.materializeEntry) {
        await live.materializeEntry({
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
      const record = await this.requireAgent(agentId);
      const session = await this.ensureSession(record);
      const result = await execInSession(session, {
        cmd: command,
        workdir: opts.workdir,
        shell: opts.shell,
        login: opts.login,
      });

      return { command, ...result };
    },
    { name: "subAgentTerminal" },
  );

  /** Returns a summary for every registered agent. */
  async listAgents(): Promise<AgentSummary[]> {
    const records = await this.store.list();
    return records.map((record) => this.summarize(record));
  }

  /** Returns the summary for one agent, or `undefined` if unknown. */
  async getAgent(agentId: string): Promise<AgentSummary | undefined> {
    const record = await this.store.load(agentId);
    return record ? this.summarize(record) : undefined;
  }

  /** Removes an agent and tears down its sandbox micro-VM. */
  async deleteAgent(agentId: string): Promise<boolean> {
    await this.closeSession(agentId, { destroy: true });
    return this.store.delete(agentId);
  }

  /**
   * Closes every live sandbox session. By default it destroys the micro-VMs
   * (the original behavior, used by one-shot runs); pass `destroy: false` to
   * detach and leave them running so a restart can re-attach.
   */
  async closeAll(opts: { destroy?: boolean } = {}): Promise<void> {
    const destroy = opts.destroy ?? true;
    await Promise.all(
      [...this.liveSessions.keys()].map((id) =>
        this.closeSession(id, { destroy }),
      ),
    );
  }

  /**
   * Graceful shutdown for the long-running service. Detaches sandboxes (keeping
   * the micro-VMs alive for re-attach) when {@link reattachSandboxes} is set,
   * otherwise destroys them — then releases the store. Records are left in a
   * durable store so a restart recovers them.
   */
  async close(): Promise<void> {
    await this.closeAll({ destroy: !this.reattachSandboxes });
    await this.store.close();
  }

  // --- internals -----------------------------------------------------------

  private buildAgent(record: PersistedAgentRecord): SandboxAgent {
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
  private buildManifest(record: PersistedAgentRecord): Manifest {
    const entries: Record<string, ReturnType<typeof file>> = {};
    for (const [entryPath, content] of record.manifestEntries) {
      entries[entryPath] = file({ content });
    }
    return new Manifest({ entries });
  }

  /**
   * Returns the agent's live Blaxel session, caching it per-process. On a cache
   * miss (first use, or the first use in a freshly restarted process) it opens
   * the session via {@link openSession}.
   *
   * Each agent has its own uniquely named micro-VM so their filesystems stay
   * isolated, and the stable per-agent name makes the sandbox easy to find in
   * the Blaxel console — and is what lets us re-attach after a restart.
   */
  private async ensureSession(
    record: PersistedAgentRecord,
  ): Promise<SandboxSessionHandle> {
    const cached = this.liveSessions.get(record.id);
    if (cached) return cached;
    const session = await this.openSession(record);
    this.liveSessions.set(record.id, session);
    return session;
  }

  /**
   * Opens the agent's sandbox. Tries to **re-attach** to its existing, uniquely
   * named micro-VM first, so files written on earlier turns — possibly in a
   * previous process — survive. Falls back to **recreating** the sandbox from
   * the stored manifest if the backend can't re-attach or the VM's TTL has
   * expired.
   *
   * Either way the conversation history is preserved by the store, so the agent
   * keeps its memory; only un-persisted scratch files are lost on the recreate
   * path (the manifest — task.md plus loaded skills — is reseeded).
   */
  private async openSession(
    record: PersistedAgentRecord,
  ): Promise<SandboxSessionHandle> {
    const name = sandboxNameFor(record.id);
    if (this.reattachSandboxes) {
      const reattached = await this.tryReattach(name);
      if (reattached) return reattached;
    }
    return this.client.create(this.buildManifest(record), { name });
  }

  /**
   * Best-effort re-attach to an existing sandbox by name. The OpenAI/Blaxel
   * sandbox client may expose this under different method names across versions
   * (or not at all), so we feature-detect; if none is available — or it throws
   * because the micro-VM is gone — we return `null` and the caller recreates
   * from the manifest.
   *
   * NOTE: verify the exact re-attach method for the installed
   * `@openai/agents-extensions` version; until then this safely degrades to
   * recreate-from-manifest on every restart.
   */
  private async tryReattach(
    name: string,
  ): Promise<SandboxSessionHandle | null> {
    const client = this.client as unknown as Record<
      string,
      ((name: string) => Promise<SandboxSessionHandle>) | undefined
    >;
    const reattach = client.connect ?? client.get ?? client.attach;
    if (typeof reattach !== "function") return null;
    try {
      return await reattach.call(this.client, name);
    } catch {
      return null;
    }
  }

  /**
   * Best-effort teardown of a live session. With `destroy` (the default) the
   * Blaxel micro-VM is deleted; otherwise the session is only detached, leaving
   * the VM running so a later {@link openSession} can re-attach to it.
   */
  private async closeSession(
    id: string,
    opts: { destroy?: boolean } = {},
  ): Promise<void> {
    const session = this.liveSessions.get(id);
    if (!session) return;
    this.liveSessions.delete(id);
    try {
      if (opts.destroy ?? true) {
        // Prefer delete() so the micro-VM is torn down, not just detached.
        await (session.delete?.() ?? session.close?.());
      } else {
        // Detach only: keep the VM alive for re-attach (fall back to delete()
        // if the backend has no close()).
        await (session.close?.() ?? session.delete?.());
      }
    } catch {
      // Best-effort cleanup; a leaked sandbox eventually expires via its TTL.
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

  private async requireAgent(agentId: string): Promise<PersistedAgentRecord> {
    const record = await this.store.load(agentId);
    if (!record) {
      throw new Error(`Unknown agent: ${agentId}`);
    }
    return record;
  }

  private summarize(record: PersistedAgentRecord): AgentSummary {
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
