import {
  BlaxelSandboxClient,
  type BlaxelSandboxClientOptions,
} from "@openai/agents-extensions/sandbox/blaxel";

/**
 * Build Blaxel sandbox options from the environment, with optional overrides.
 *
 * Auth (`BL_API_KEY`, `BL_WORKSPACE`) is read by the underlying `@blaxel/core`
 * SDK; the values here only tune the micro-VM. Anything left unset falls back to
 * a Blaxel default. `overrides` win over the env-derived values — sub-agents use
 * this to assign a unique sandbox `name` per agent so each gets its own micro-VM.
 */
export function getBlaxelSandboxOptions(
  overrides: Partial<BlaxelSandboxClientOptions> = {},
): BlaxelSandboxClientOptions {
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

  return { ...options, ...overrides };
}

/** A live Blaxel sandbox session, as returned by the client's `create`. */
type SandboxSessionHandle = Awaited<ReturnType<BlaxelSandboxClient["create"]>>;

/**
 * Installs packages into a freshly-created sandbox. The Blaxel base image is
 * minimal Alpine (running as root) without `curl`, which agents reach for
 * constantly, so we bootstrap it here. Configurable via `SANDBOX_APK_PACKAGES`
 * (space-separated; defaults to `curl`, set to `none` to disable).
 *
 * Best-effort: `apk` is idempotent (re-runs are cheap no-ops) and failures never
 * abort sandbox creation — the agent can still fall back to `wget`/`python3`.
 */
async function installSandboxPackages(
  session: SandboxSessionHandle,
): Promise<void> {
  const configured = process.env.SANDBOX_APK_PACKAGES?.trim();
  const packages = configured === undefined ? "curl" : configured;
  if (!packages || packages.toLowerCase() === "none") return;

  const cmd = `command -v apk >/dev/null 2>&1 && apk add --no-cache ${packages} || true`;
  // exec/execCommand vary across sandbox backends — feature-detect like
  // agents/sub_agents does.
  const exec = session as unknown as {
    exec?: (args: { cmd: string }) => Promise<unknown>;
    execCommand?: (args: { cmd: string }) => Promise<unknown>;
  };
  try {
    if (typeof exec.exec === "function") await exec.exec({ cmd });
    else if (typeof exec.execCommand === "function") await exec.execCommand({ cmd });
  } catch (err) {
    console.warn(
      "[blaxel] sandbox package bootstrap failed:",
      err instanceof Error ? err.message : String(err),
    );
  }
}

/**
 * A {@link BlaxelSandboxClient} that bootstraps each new sandbox (installs
 * `curl`, etc.) right after it's created. Subclassing the client means both
 * `agents/main_agent` (which passes `sandbox: { client }`) and
 * `agents/sub_agents` (which calls `client.create`) get the bootstrap on every
 * micro-VM, without either run loop changing.
 */
class BootstrappingBlaxelSandboxClient extends BlaxelSandboxClient {
  async create(
    ...args: Parameters<BlaxelSandboxClient["create"]>
  ): Promise<SandboxSessionHandle> {
    const session = await super.create(...args);
    await installSandboxPackages(session);
    return session;
  }
}

/**
 * Construct a {@link BlaxelSandboxClient} configured from the environment.
 *
 * Shared by `agents/main_agent` (one sandbox) and `agents/sub_agents` (one
 * sandbox per agent) so the compute backend stays consistent across both. The
 * returned client bootstraps each new sandbox via {@link installSandboxPackages}.
 */
export function createBlaxelSandboxClient(
  overrides?: Partial<BlaxelSandboxClientOptions>,
): BlaxelSandboxClient {
  return new BootstrappingBlaxelSandboxClient(getBlaxelSandboxOptions(overrides));
}

export { BlaxelSandboxClient, type BlaxelSandboxClientOptions };
