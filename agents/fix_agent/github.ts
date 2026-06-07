const GITHUB_API = "https://api.github.com";

export type FileChange = {
  path: string;
  content: string;
};

export type PrResult = {
  prUrl: string;
  branchName: string;
  prNumber: number;
};

function parseRepo(repository: string): { owner: string; repo: string } {
  const clean = repository
    .replace(/^https?:\/\/github\.com\//, "")
    .replace(/\.git$/, "");
  const [owner, repo] = clean.split("/");
  if (!owner || !repo) throw new Error(`Invalid GitHub repository URL: ${repository}`);
  return { owner, repo };
}

export class GitHubClient {
  private readonly token: string;
  private readonly owner: string;
  private readonly repo: string;

  constructor(token: string, repository: string) {
    this.token = token;
    const { owner, repo } = parseRepo(repository);
    this.owner = owner;
    this.repo = repo;
  }

  private async request(method: string, path: string, body?: unknown): Promise<unknown> {
    const res = await fetch(`${GITHUB_API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });

    const text = await res.text();
    if (!res.ok) {
      throw new Error(`GitHub ${method} ${path} → ${res.status}: ${text.slice(0, 400)}`);
    }
    return text ? (JSON.parse(text) as unknown) : {};
  }

  async getDefaultBranch(): Promise<string> {
    const data = (await this.request("GET", `/repos/${this.owner}/${this.repo}`)) as {
      default_branch: string;
    };
    return data.default_branch;
  }

  private async getRefSha(ref: string): Promise<string> {
    const data = (await this.request(
      "GET",
      `/repos/${this.owner}/${this.repo}/git/refs/heads/${encodeURIComponent(ref)}`,
    )) as { object: { sha: string } };
    return data.object.sha;
  }

  async createBranch(branchName: string, fromRef: string): Promise<void> {
    const sha = await this.getRefSha(fromRef);
    await this.request("POST", `/repos/${this.owner}/${this.repo}/git/refs`, {
      ref: `refs/heads/${branchName}`,
      sha,
    });
  }

  private async getFileSha(filePath: string, ref: string): Promise<string | null> {
    try {
      const data = (await this.request(
        "GET",
        `/repos/${this.owner}/${this.repo}/contents/${filePath}?ref=${encodeURIComponent(ref)}`,
      )) as { sha: string };
      return data.sha;
    } catch {
      return null;
    }
  }

  async commitFile(
    filePath: string,
    content: string,
    branch: string,
    message: string,
  ): Promise<void> {
    const sha = await this.getFileSha(filePath, branch);
    await this.request("PUT", `/repos/${this.owner}/${this.repo}/contents/${filePath}`, {
      message,
      content: Buffer.from(content, "utf8").toString("base64"),
      branch,
      ...(sha ? { sha } : {}),
    });
  }

  async openPr(title: string, body: string, head: string, base: string): Promise<PrResult> {
    const data = (await this.request("POST", `/repos/${this.owner}/${this.repo}/pulls`, {
      title,
      body,
      head,
      base,
    })) as { html_url: string; number: number };

    return { prUrl: data.html_url, branchName: head, prNumber: data.number };
  }
}
