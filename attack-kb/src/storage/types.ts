import type {
  AttackKbCanonicalObject,
  AttackKbDomain,
  AttackKbStorageObjectType,
} from "../types.js";

export type AttackKbStorageQuery = {
  objectType?: AttackKbStorageObjectType;
  domain?: AttackKbDomain;
  ids?: string[];
  text?: string;
  limit?: number;
};

export type AttackKbStorageBackend = "local-memory" | "local-json" | "redis-iris";

export type AttackKbStorageAdapter = {
  name: string;
  backend: AttackKbStorageBackend;
  put(object: AttackKbCanonicalObject): Promise<void>;
  putMany(objects: AttackKbCanonicalObject[]): Promise<void>;
  get(id: string): Promise<AttackKbCanonicalObject | undefined>;
  list(query?: AttackKbStorageQuery): Promise<AttackKbCanonicalObject[]>;
  close?(): Promise<void>;
};
