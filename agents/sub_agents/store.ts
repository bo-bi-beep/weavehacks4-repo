/**
 * Persistence for the sub-agent registry.
 *
 * {@link SubAgentService} keeps each agent's *serializable* state — identity,
 * instructions, the accumulated workspace manifest, loaded skills, and the
 * conversation history — in a {@link SubAgentStore}. The live Blaxel sandbox
 * session is deliberately **not** stored here: it is a per-process socket that
 * cannot be serialized, so the service caches it in memory and re-opens it on
 * demand (see `ensureSession` in `service.ts`).
 *
 * Two implementations ship:
 * - {@link InMemorySubAgentStore} — process-local, the default. State is lost on
 *   restart (matches the service's original behavior).
 * - {@link RedisSubAgentStore} (in `redis_store.ts`) — durable and shareable, so
 *   a restarted or horizontally-scaled service recovers every agent's identity,
 *   skills, and chat memory. Enabled by setting `REDIS_URL`.
 */

/** The serializable slice of an agent — everything except its live session. */
export interface PersistedAgentRecord {
  id: string;
  name: string;
  model: string;
  instructions: string;
  /** Workspace-relative path -> file content. Seeds the sandbox on (re)create. */
  manifestEntries: Map<string, string>;
  /** Loaded skill names, in load order. */
  skills: string[];
  /** SDK conversation history, replayed as input on the next turn. */
  history: unknown[];
}

/**
 * A key/value home for {@link PersistedAgentRecord}s, keyed by agent id.
 *
 * Contract: `load` returns an independent copy of the record; mutate it, then
 * call `save` to persist the change. (The in-memory store round-trips through
 * the same JSON as Redis so both behave identically — callers can't rely on
 * mutating a shared reference.)
 */
export interface SubAgentStore {
  /** Returns the record for `id`, or `undefined` if unknown. */
  load(id: string): Promise<PersistedAgentRecord | undefined>;
  /** Upserts a record (and registers it in the index used by {@link list}). */
  save(record: PersistedAgentRecord): Promise<void>;
  /** Removes a record; resolves to whether it existed. */
  delete(id: string): Promise<boolean>;
  /** Returns every stored record. */
  list(): Promise<PersistedAgentRecord[]>;
  /** Releases any backing resources (e.g. a Redis connection). */
  close(): Promise<void>;
}

/** On-disk/on-wire shape: a {@link PersistedAgentRecord} with the Map flattened. */
interface StoredShape {
  id: string;
  name: string;
  model: string;
  instructions: string;
  manifestEntries: Record<string, string>;
  skills: string[];
  history: unknown[];
}

/**
 * Serializes a record to JSON. `manifestEntries` is a `Map`, which
 * `JSON.stringify` would turn into `{}`, so it is flattened to a plain object.
 * Shared by every store so their encodings are byte-for-byte identical.
 */
export function serializeRecord(record: PersistedAgentRecord): string {
  const shape: StoredShape = {
    id: record.id,
    name: record.name,
    model: record.model,
    instructions: record.instructions,
    manifestEntries: Object.fromEntries(record.manifestEntries),
    skills: record.skills,
    history: record.history,
  };
  return JSON.stringify(shape);
}

/** Inverse of {@link serializeRecord}; rebuilds the `manifestEntries` Map. */
export function deserializeRecord(json: string): PersistedAgentRecord {
  const shape = JSON.parse(json) as StoredShape;
  return {
    id: shape.id,
    name: shape.name,
    model: shape.model,
    instructions: shape.instructions,
    manifestEntries: new Map(Object.entries(shape.manifestEntries ?? {})),
    skills: shape.skills ?? [],
    history: shape.history ?? [],
  };
}

/**
 * Default store: a process-local registry. Records are held as serialized JSON
 * so that, exactly like the Redis store, every `load`/`list` hands back an
 * independent copy and callers must `save` to persist mutations.
 */
export class InMemorySubAgentStore implements SubAgentStore {
  private readonly data = new Map<string, string>();

  async load(id: string): Promise<PersistedAgentRecord | undefined> {
    const json = this.data.get(id);
    return json ? deserializeRecord(json) : undefined;
  }

  async save(record: PersistedAgentRecord): Promise<void> {
    this.data.set(record.id, serializeRecord(record));
  }

  async delete(id: string): Promise<boolean> {
    return this.data.delete(id);
  }

  async list(): Promise<PersistedAgentRecord[]> {
    return [...this.data.values()].map(deserializeRecord);
  }

  async close(): Promise<void> {
    // Nothing to release.
  }
}

/**
 * Picks a store from the environment: a {@link RedisSubAgentStore} when
 * `REDIS_URL` is set (durable; survives restarts and can back multiple
 * instances), otherwise an {@link InMemorySubAgentStore}. The Redis client is
 * imported lazily so the dependency is only loaded when actually configured.
 */
export async function createSubAgentStore(): Promise<SubAgentStore> {
  const url = process.env.REDIS_URL?.trim();
  if (!url) return new InMemorySubAgentStore();
  const { RedisSubAgentStore } = await import("./redis_store.js");
  return RedisSubAgentStore.connect(url);
}
