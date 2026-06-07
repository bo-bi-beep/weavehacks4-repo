import { requireEnv } from "./lib/weave.js";

/**
 * Minimal client for the Cursor Background Agents (Cloud Agents) API.
 *
 * Cloud Agents run autonomously in a remote sandbox: given a prompt + a GitHub
 * repository, they clone the repo, edit code on a branch, and (with
 * `autoCreatePr`) open a pull request. We use one to remediate the Loan Approval
 * Agent from the traces of a successful attack.
 *
 * Docs: https://docs.cursor.com/background-agent/api
 *
 * Response parsing is intentionally defensive — the API is young and a few
 * fields have moved between previews, so {@link normalizeAgent} reads several
 * plausible field names and never throws on a shape it doesn't recognise.
 */

const DEFAULT_API_URL = "https://api.cursor.com";

export type CursorAgentStatus =
  | "PENDING"
  | "CREATING"
  | "RUNNING"
  | "FINISHED"
  | "ERROR"
  | "EXPIRED"
  | "CANCELLED"
  // The API may introduce new statuses; keep the union open.
  | (string & {});

export type CursorAgentTarget = {
  /** Cursor web URL where a human can watch the agent work. Available immediately. */
  url?: string;
  /** Branch the agent pushes to. Available early, before the PR exists. */
  branchName?: string;
  /** GitHub pull request URL. Populated once the agent opens the PR. */
  prUrl?: string;
};

export type CursorAgent = {
  id: string;
  name?: string;
  status: CursorAgentStatus;
  source?: { repository?: string; ref?: string };
  target?: CursorAgentTarget;
  createdAt?: string;
  /** Original, un-normalized payload, kept for debugging/forward-compat. */
  raw?: unknown;
};

export type CursorConversationMessage = {
  id?: string;
  type?: "user" | "assistant" | string;
  text?: string;
};

export type LaunchAgentInput = {
  prompt: string;
  /** Full GitHub repo URL, e.g. https://github.com/owner/repo */
  repository: string;
  ref?: string;
  model?: string;
  branchName?: string;
  autoCreatePr?: boolean;
};

export type WaitOptions = {
  /** Stop waiting after this long and return the latest snapshot. Default 10 min. */
  timeoutMs?: number;
  /** How often to poll. Default 5s. */
  pollIntervalMs?: number;
  signal?: AbortSignal;
  onPoll?: (agent: CursorAgent) => void;
};

export type CursorClientOptions = {
  apiKey?: string;
  apiUrl?: string;
  /** Injectable for tests. Defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
};

const TERMINAL_STATUSES = new Set(["FINISHED", "ERROR", "EXPIRED", "CANCELLED"]);

export function isTerminalStatus(status: CursorAgentStatus | undefined): boolean {
  return status ? TERMINAL_STATUSES.has(String(status).toUpperCase()) : false;
}

export class CursorClient {
  private readonly apiKey: string;
  private readonly apiUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: CursorClientOptions = {}) {
    this.apiKey = options.apiKey ?? requireEnv("CURSOR_API_KEY");
    this.apiUrl = (options.apiUrl ?? process.env.CURSOR_API_URL ?? DEFAULT_API_URL).replace(
      /\/+$/,
      "",
    );
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  /** Launch a background agent. Returns as soon as the agent is created. */
  async launchAgent(input: LaunchAgentInput): Promise<CursorAgent> {
    const body = {
      prompt: { text: input.prompt },
      source: {
        repository: input.repository,
        ref: input.ref ?? "main",
      },
      ...(input.model ? { model: input.model } : {}),
      target: {
        autoCreatePr: input.autoCreatePr ?? true,
        ...(input.branchName ? { branchName: input.branchName } : {}),
      },
    };
    return normalizeAgent(await this.request("POST", "/v0/agents", body));
  }

  async getAgent(id: string): Promise<CursorAgent> {
    return normalizeAgent(await this.request("GET", `/v0/agents/${encodeURIComponent(id)}`));
  }

  async getConversation(
    id: string,
  ): Promise<{ id?: string; messages: CursorConversationMessage[] }> {
    const data = (await this.request(
      "GET",
      `/v0/agents/${encodeURIComponent(id)}/conversation`,
    )) as { id?: string; messages?: CursorConversationMessage[] };
    return { id: data?.id, messages: Array.isArray(data?.messages) ? data.messages : [] };
  }

  /**
   * Poll until the agent opens a PR, reaches a terminal status, the timeout
   * elapses, or the caller aborts — whichever comes first. Always resolves with
   * the latest snapshot; it never rejects on timeout.
   */
  async waitForAgent(id: string, options: WaitOptions = {}): Promise<CursorAgent> {
    const timeoutMs = options.timeoutMs ?? 600_000;
    const pollIntervalMs = options.pollIntervalMs ?? 5_000;
    const deadline = Date.now() + timeoutMs;

    let agent = await this.getAgent(id);
    while (true) {
      options.onPoll?.(agent);
      if (agent.target?.prUrl) return agent;
      if (isTerminalStatus(agent.status)) return agent;
      if (options.signal?.aborted) return agent;
      const remaining = deadline - Date.now();
      if (remaining <= 0) return agent;
      await sleep(Math.min(pollIntervalMs, remaining), options.signal);
      if (options.signal?.aborted) return agent;
      agent = await this.getAgent(id);
    }
  }

  private async request(method: string, path: string, body?: unknown): Promise<unknown> {
    const res = await this.fetchImpl(`${this.apiUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

    const text = await res.text();
    if (!res.ok) {
      throw new Error(
        `Cursor API ${method} ${path} failed: ${res.status} ${res.statusText} — ${text.slice(0, 500)}`,
      );
    }
    if (!text) return {};
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`Cursor API ${method} ${path} returned non-JSON: ${text.slice(0, 200)}`);
    }
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (ms <= 0) return resolve();
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

/** Read the fields we care about across a few plausible API shapes. */
export function normalizeAgent(raw: unknown): CursorAgent {
  const obj = (raw ?? {}) as Record<string, any>;
  const target = (obj.target ?? {}) as Record<string, any>;

  const id = String(obj.id ?? obj.agentId ?? "");
  const status = (obj.status ?? obj.state ?? "UNKNOWN") as CursorAgentStatus;

  return {
    id,
    name: obj.name,
    status,
    source: obj.source
      ? { repository: obj.source.repository, ref: obj.source.ref }
      : undefined,
    target: {
      url: target.url ?? obj.url,
      branchName: target.branchName ?? obj.branchName,
      prUrl: target.prUrl ?? target.pullRequestUrl ?? obj.prUrl ?? obj.pullRequest?.url,
    },
    createdAt: obj.createdAt ?? obj.created_at,
    raw,
  };
}
