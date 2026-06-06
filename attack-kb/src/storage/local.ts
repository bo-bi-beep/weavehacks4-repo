import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { AttackKbCanonicalObject } from "../types.js";
import { matchesAttackKbStorageQuery } from "./query.js";
import type { AttackKbStorageAdapter } from "./types.js";

type LocalAttackKbStoreFile = {
  schemaVersion: 1;
  objects: AttackKbCanonicalObject[];
};

export type LocalAttackKbStorageOptions = {
  name?: string;
  seedObjects?: AttackKbCanonicalObject[];
  jsonPath?: string;
};

function parseStoreFile(raw: string, jsonPath: string): AttackKbCanonicalObject[] {
  const parsed = JSON.parse(raw) as Partial<LocalAttackKbStoreFile>;

  if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.objects)) {
    throw new Error(`Invalid Attack KB local store file at ${jsonPath}`);
  }

  return parsed.objects;
}

export function createLocalAttackKbStorageAdapter(
  options: LocalAttackKbStorageOptions = {},
): AttackKbStorageAdapter {
  const objects = new Map<string, AttackKbCanonicalObject>();
  const seedObjects = options.seedObjects ?? [];
  let loaded = false;

  async function persist(): Promise<void> {
    if (!options.jsonPath) {
      return;
    }

    await mkdir(dirname(options.jsonPath), { recursive: true });
    const file: LocalAttackKbStoreFile = {
      schemaVersion: 1,
      objects: [...objects.values()],
    };
    await writeFile(options.jsonPath, `${JSON.stringify(file, null, 2)}\n`, "utf8");
  }

  async function ensureLoaded(): Promise<void> {
    if (loaded) {
      return;
    }

    if (options.jsonPath) {
      try {
        const raw = await readFile(options.jsonPath, "utf8");
        for (const object of parseStoreFile(raw, options.jsonPath)) {
          objects.set(object.id, object);
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          throw error;
        }

        for (const object of seedObjects) {
          objects.set(object.id, object);
        }
        await persist();
      }
    } else {
      for (const object of seedObjects) {
        objects.set(object.id, object);
      }
    }

    loaded = true;
  }

  return {
    name: options.name ?? (options.jsonPath ? "local-json" : "local-memory"),
    backend: options.jsonPath ? "local-json" : "local-memory",
    async put(object) {
      await ensureLoaded();
      objects.set(object.id, object);
      await persist();
    },
    async putMany(nextObjects) {
      await ensureLoaded();
      for (const object of nextObjects) {
        objects.set(object.id, object);
      }
      await persist();
    },
    async get(id) {
      await ensureLoaded();
      return objects.get(id);
    },
    async list(query = {}) {
      await ensureLoaded();
      const results = [...objects.values()].filter((object) => matchesAttackKbStorageQuery(object, query));
      return typeof query.limit === "number" ? results.slice(0, query.limit) : results;
    },
  };
}
