import { createClient, type RedisClientType } from "redis";

import {
  deserializeRecord,
  serializeRecord,
  type PersistedAgentRecord,
  type SubAgentStore,
} from "./store.js";

/**
 * Durable {@link SubAgentStore} backed by Redis. Layout:
 *
 *   subagent:<id>     -> JSON of the agent record (see serializeRecord)
 *   subagent:index    -> a Set of all agent ids (powers `list`)
 *
 * The session handle is never stored — only the serializable record (identity,
 * instructions, manifest, skills, chat history). On restart the service reloads
 * these and re-opens each agent's sandbox by name (see `service.ts`).
 *
 * Set `SUBAGENT_TTL_SECONDS` to expire records in step with the Blaxel
 * micro-VM's own TTL, so a registry entry can't outlive the sandbox it points
 * at; the key prefix is configurable via `REDIS_KEY_PREFIX` (default `subagent`).
 */
const KEY_PREFIX = process.env.REDIS_KEY_PREFIX?.trim() || "subagent";
const INDEX_KEY = `${KEY_PREFIX}:index`;
const recordKey = (id: string): string => `${KEY_PREFIX}:${id}`;

/** Optional per-record TTL (seconds); `undefined` means records never expire. */
function ttlSeconds(): number | undefined {
  const raw = Number(process.env.SUBAGENT_TTL_SECONDS?.trim());
  return Number.isFinite(raw) && raw > 0 ? raw : undefined;
}

export class RedisSubAgentStore implements SubAgentStore {
  private constructor(private readonly client: RedisClientType) {}

  /** Connects to Redis at `url` and returns a ready store. */
  static async connect(url: string): Promise<RedisSubAgentStore> {
    const client: RedisClientType = createClient({ url });
    client.on("error", (err) =>
      console.error("[sub_agents] redis client error:", err),
    );
    await client.connect();
    return new RedisSubAgentStore(client);
  }

  async load(id: string): Promise<PersistedAgentRecord | undefined> {
    const json = await this.client.get(recordKey(id));
    return json ? deserializeRecord(json) : undefined;
  }

  async save(record: PersistedAgentRecord): Promise<void> {
    const ttl = ttlSeconds();
    const json = serializeRecord(record);
    await this.client
      .multi()
      .set(recordKey(record.id), json, ttl ? { EX: ttl } : {})
      .sAdd(INDEX_KEY, record.id)
      .exec();
  }

  async delete(id: string): Promise<boolean> {
    const reply = await this.client
      .multi()
      .del(recordKey(id))
      .sRem(INDEX_KEY, id)
      .exec();
    // reply[0] is the DEL count: > 0 means the record existed.
    return Number(reply?.[0] ?? 0) > 0;
  }

  async list(): Promise<PersistedAgentRecord[]> {
    const ids = await this.client.sMembers(INDEX_KEY);
    if (ids.length === 0) return [];

    const jsons = await this.client.mGet(ids.map(recordKey));
    const records: PersistedAgentRecord[] = [];
    const stale: string[] = [];
    ids.forEach((id, i) => {
      const json = jsons[i];
      if (json) records.push(deserializeRecord(json));
      // Record expired via TTL but its id lingers in the index — prune it.
      else stale.push(id);
    });
    if (stale.length) await this.client.sRem(INDEX_KEY, stale);
    return records;
  }

  async close(): Promise<void> {
    await this.client.quit();
  }
}
