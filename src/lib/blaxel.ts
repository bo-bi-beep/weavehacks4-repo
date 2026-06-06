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

/**
 * Construct a {@link BlaxelSandboxClient} configured from the environment.
 *
 * Shared by `agents/main_agent` (one sandbox) and `agents/sub_agents` (one
 * sandbox per agent) so the compute backend stays consistent across both.
 */
export function createBlaxelSandboxClient(
  overrides?: Partial<BlaxelSandboxClientOptions>,
): BlaxelSandboxClient {
  return new BlaxelSandboxClient(getBlaxelSandboxOptions(overrides));
}

export { BlaxelSandboxClient, type BlaxelSandboxClientOptions };
