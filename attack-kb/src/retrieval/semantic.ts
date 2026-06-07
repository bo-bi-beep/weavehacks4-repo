import { createHash } from "node:crypto";

import {
  createAttackKbRedisClient,
  readAttackKbRedisConnectionConfig,
  type AttackKbRedisClient,
  type AttackKbRedisUrlSource,
} from "../redis/client.js";
import {
  getDefaultAttackKbStorageAdapter,
  type AttackKbStorageAdapter,
  type AttackKbStorageQuery,
} from "../storage/index.js";
import type {
  AttackKbCanonicalObject,
  AttackKbDomain,
  AttackKbStorageObjectType,
} from "../types.js";

export const ATTACK_KB_VECTOR_BACKENDS = ["local", "redis", "auto"] as const;
export type AttackKbVectorBackend = (typeof ATTACK_KB_VECTOR_BACKENDS)[number];

export const ATTACK_KB_VECTOR_INDEX_ALGORITHMS = ["HNSW", "FLAT"] as const;
export type AttackKbVectorIndexAlgorithm = (typeof ATTACK_KB_VECTOR_INDEX_ALGORITHMS)[number];

export const ATTACK_KB_EMBEDDING_PROVIDERS = ["deterministic", "openai"] as const;
export type AttackKbEmbeddingProviderName = (typeof ATTACK_KB_EMBEDDING_PROVIDERS)[number];

export type AttackKbEmbeddingProvider = {
  name: string;
  dimensions: number;
  embed(text: string): Float32Array | Promise<Float32Array>;
};

export type AttackKbVectorRetrievalConfig = {
  backend: AttackKbVectorBackend;
  embedding: {
    provider: AttackKbEmbeddingProviderName;
    dimensions: number;
    deterministicSeed: string;
    openAIModel: string;
  };
  redis: {
    url?: string;
    urlSource?: AttackKbRedisUrlSource | "ATTACK_KB_VECTOR_REDIS_URL";
    indexName: string;
    keyPrefix: string;
    fallbackToLocal: boolean;
    indexAlgorithm: AttackKbVectorIndexAlgorithm;
    materializeOnSearch: boolean;
  };
  maxChunkChars: number;
};

export type AttackKbSemanticContextFilters = {
  ids?: string[];
  domain?: AttackKbDomain | AttackKbDomain[];
  objectType?: AttackKbStorageObjectType | AttackKbStorageObjectType[];
  status?: string | string[];
  sourceCategory?: string | string[];
};

export type AttackKbRetrievalChunk = {
  id: string;
  objectId: string;
  chunkOrdinal: number;
  objectType: AttackKbStorageObjectType;
  domain?: AttackKbDomain;
  status?: string;
  sourceCategory?: string;
  title: string;
  text: string;
  tags: string[];
  sourceRefs: string[];
  updatedAt: string;
};

export type AttackKbSemanticContextResult = {
  object: AttackKbCanonicalObject;
  chunk: AttackKbRetrievalChunk;
  score: number;
  vectorScore: number;
  lexicalScore: number;
  backend: "local" | "redis";
  redisDistance?: number;
};

export type AttackKbSemanticContextSearchOptions = {
  storage?: AttackKbStorageAdapter;
  config?: AttackKbVectorRetrievalConfig;
  embeddingProvider?: AttackKbEmbeddingProvider;
  redisClient?: AttackKbRedisClient;
  limit?: number;
  topK?: number;
  vectorWeight?: number;
  lexicalWeight?: number;
  minScore?: number;
  materialize?: boolean;
};

export type AttackKbSemanticContextSearchResponse = {
  query: string;
  filters: AttackKbSemanticContextFilters;
  generatedAt: string;
  backend: "local" | "redis";
  embeddingProvider: string;
  dimensions: number;
  indexName?: string;
  keyPrefix?: string;
  fallbackReason?: string;
  results: AttackKbSemanticContextResult[];
};

export type AttackKbVectorIndexSchema = {
  indexName: string;
  keyPrefix: string;
  documentKeyPattern: string;
  algorithm: AttackKbVectorIndexAlgorithm;
  dimensions: number;
  distanceMetric: "COSINE";
  fields: Array<{
    name: string;
    kind: "TAG" | "TEXT" | "NUMERIC" | "VECTOR";
    note?: string;
  }>;
  ftCreateCommand: string[];
};

export type AttackKbSemanticIndexingOptions = {
  storage?: AttackKbStorageAdapter;
  config?: AttackKbVectorRetrievalConfig;
  embeddingProvider?: AttackKbEmbeddingProvider;
  redisClient?: AttackKbRedisClient;
  objects?: AttackKbCanonicalObject[];
};

export type AttackKbSemanticIndexingResult = {
  backend: "redis";
  indexName: string;
  keyPrefix: string;
  embeddingProvider: string;
  dimensions: number;
  objectsIndexed: number;
  chunksIndexed: number;
  schema: AttackKbVectorIndexSchema;
};

type RedisCommandArgument = string | Buffer;

type RedisSearchRow = {
  key: string;
  fields: Record<string, string>;
};

const DEFAULT_VECTOR_DIMENSIONS = 384;
const DEFAULT_MAX_CHUNK_CHARS = 2_400;
const DEFAULT_VECTOR_WEIGHT = 0.75;
const DEFAULT_LEXICAL_WEIGHT = 0.25;
const MISSING_TAG_VALUE = "__none__";

let warnedAboutRedisFallback = false;

function env(name: string, source: NodeJS.ProcessEnv = process.env): string | undefined {
  const value = source[name]?.trim();
  return value ? value : undefined;
}

function parseBackend(value: string | undefined): AttackKbVectorBackend {
  const normalized = value?.toLowerCase() || "local";

  if (!ATTACK_KB_VECTOR_BACKENDS.includes(normalized as AttackKbVectorBackend)) {
    throw new Error(
      `Unsupported ATTACK_KB_VECTOR_BACKEND: ${value}. Supported values: ${ATTACK_KB_VECTOR_BACKENDS.join(", ")}.`,
    );
  }

  return normalized as AttackKbVectorBackend;
}

function parseEmbeddingProvider(value: string | undefined): AttackKbEmbeddingProviderName {
  const normalized = value?.toLowerCase() || "deterministic";

  if (!ATTACK_KB_EMBEDDING_PROVIDERS.includes(normalized as AttackKbEmbeddingProviderName)) {
    throw new Error(
      `Unsupported ATTACK_KB_EMBEDDING_PROVIDER: ${value}. Supported values: ${ATTACK_KB_EMBEDDING_PROVIDERS.join(", ")}.`,
    );
  }

  return normalized as AttackKbEmbeddingProviderName;
}

function parseIndexAlgorithm(value: string | undefined): AttackKbVectorIndexAlgorithm {
  const normalized = (value || "HNSW").toUpperCase();

  if (!ATTACK_KB_VECTOR_INDEX_ALGORITHMS.includes(normalized as AttackKbVectorIndexAlgorithm)) {
    throw new Error(
      `Unsupported ATTACK_KB_VECTOR_INDEX_ALGORITHM: ${value}. Supported values: ${ATTACK_KB_VECTOR_INDEX_ALGORITHMS.join(", ")}.`,
    );
  }

  return normalized as AttackKbVectorIndexAlgorithm;
}

function parsePositiveInteger(value: string | undefined, defaultValue: number, name: string): number {
  if (!value) {
    return defaultValue;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Unsupported ${name}: ${value}. Use a positive integer.`);
  }

  return parsed;
}

function parseBoolean(value: string | undefined, defaultValue: boolean, name: string): boolean {
  if (value === undefined) {
    return defaultValue;
  }

  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "n", "off"].includes(normalized)) {
    return false;
  }

  throw new Error(`Unsupported boolean ${name}: ${value}. Use true/false or 1/0.`);
}

function parseFallback(value: string | undefined): boolean {
  const normalized = value?.toLowerCase();

  if (!normalized || normalized === "local" || normalized === "true" || normalized === "1") {
    return true;
  }

  if (normalized === "disabled" || normalized === "false" || normalized === "0" || normalized === "none") {
    return false;
  }

  throw new Error(`Unsupported ATTACK_KB_VECTOR_REDIS_FALLBACK: ${value}. Use "local" or "disabled".`);
}

function normalizeKeyPrefix(prefix: string): string {
  return prefix.replace(/:+$/u, "") || "attack-kb:vector";
}

function defaultVectorIndexName(namespace: string): string {
  return `${namespace.replace(/[^a-zA-Z0-9_-]/gu, "-")}-vector`;
}

export function getAttackKbVectorRetrievalConfig(
  source: NodeJS.ProcessEnv = process.env,
): AttackKbVectorRetrievalConfig {
  const redisConnection = readAttackKbRedisConnectionConfig(source);
  const vectorUrl = env("ATTACK_KB_VECTOR_REDIS_URL", source);
  const namespace = env("ATTACK_KB_REDIS_IRIS_NAMESPACE", source) || "attack-kb";

  return {
    backend: parseBackend(env("ATTACK_KB_VECTOR_BACKEND", source)),
    embedding: {
      provider: parseEmbeddingProvider(env("ATTACK_KB_EMBEDDING_PROVIDER", source)),
      dimensions: parsePositiveInteger(
        env("ATTACK_KB_VECTOR_DIMENSIONS", source),
        DEFAULT_VECTOR_DIMENSIONS,
        "ATTACK_KB_VECTOR_DIMENSIONS",
      ),
      deterministicSeed: env("ATTACK_KB_VECTOR_DETERMINISTIC_SEED", source) || "attack-kb-vector-v1",
      openAIModel: env("ATTACK_KB_OPENAI_EMBEDDING_MODEL", source) || "text-embedding-3-small",
    },
    redis: {
      url: vectorUrl || redisConnection.url,
      urlSource: vectorUrl ? "ATTACK_KB_VECTOR_REDIS_URL" : redisConnection.urlSource,
      indexName: env("ATTACK_KB_VECTOR_INDEX", source) || defaultVectorIndexName(namespace),
      keyPrefix: normalizeKeyPrefix(env("ATTACK_KB_VECTOR_KEY_PREFIX", source) || `${namespace}:vector`),
      fallbackToLocal: parseFallback(env("ATTACK_KB_VECTOR_REDIS_FALLBACK", source)),
      indexAlgorithm: parseIndexAlgorithm(env("ATTACK_KB_VECTOR_INDEX_ALGORITHM", source)),
      materializeOnSearch: parseBoolean(
        env("ATTACK_KB_VECTOR_MATERIALIZE_ON_SEARCH", source),
        true,
        "ATTACK_KB_VECTOR_MATERIALIZE_ON_SEARCH",
      ),
    },
    maxChunkChars: parsePositiveInteger(
      env("ATTACK_KB_VECTOR_MAX_CHUNK_CHARS", source),
      DEFAULT_MAX_CHUNK_CHARS,
      "ATTACK_KB_VECTOR_MAX_CHUNK_CHARS",
    ),
  };
}

export function createDeterministicAttackKbEmbeddingProvider(
  options: Pick<AttackKbVectorRetrievalConfig["embedding"], "dimensions" | "deterministicSeed">,
): AttackKbEmbeddingProvider {
  return {
    name: "deterministic-hash",
    dimensions: options.dimensions,
    embed(text) {
      return deterministicTextEmbedding(text, options);
    },
  };
}

export function createDeferredOpenAIEmbeddingProvider(
  options: Pick<AttackKbVectorRetrievalConfig["embedding"], "dimensions" | "openAIModel">,
): AttackKbEmbeddingProvider {
  return {
    name: `openai:${options.openAIModel}:deferred`,
    dimensions: options.dimensions,
    embed() {
      throw new Error(
        [
          "ATTACK_KB_EMBEDDING_PROVIDER=openai is an env seam only in this P0 slice.",
          "Real OpenAI embedding calls are deferred so deterministic demos/tests never consume external API usage.",
          "Pass a custom embeddingProvider to searchAttackKbSemanticContext, or set ATTACK_KB_EMBEDDING_PROVIDER=deterministic.",
        ].join(" "),
      );
    },
  };
}

function resolveEmbeddingProvider(
  options: AttackKbSemanticContextSearchOptions | AttackKbSemanticIndexingOptions,
  config: AttackKbVectorRetrievalConfig,
): AttackKbEmbeddingProvider {
  if (options.embeddingProvider) {
    return options.embeddingProvider;
  }

  if (config.embedding.provider === "openai") {
    return createDeferredOpenAIEmbeddingProvider(config.embedding);
  }

  return createDeterministicAttackKbEmbeddingProvider(config.embedding);
}

export function deterministicTextEmbedding(
  text: string,
  options: Pick<AttackKbVectorRetrievalConfig["embedding"], "dimensions" | "deterministicSeed">,
): Float32Array {
  const dimensions = Math.max(1, options.dimensions);
  const vector = new Float32Array(dimensions);
  const tokens = tokenize(text);
  const weightedTokens = tokens.length > 0 ? tokens : [text.toLowerCase() || "empty"];

  for (const token of weightedTokens) {
    const digest = createHash("sha256").update(`${options.deterministicSeed}:${token}`).digest();
    const index = digest.readUInt32BE(0) % dimensions;
    const sign = (digest[4] & 1) === 0 ? 1 : -1;
    const weight = 1 + Math.min(token.length, 24) / 24;
    vector[index] += sign * weight;

    // Add a second low-weight projection so short queries still get enough spread
    // for demos while remaining deterministic and API-free.
    const secondaryIndex = digest.readUInt32BE(5) % dimensions;
    const secondarySign = (digest[9] & 1) === 0 ? 1 : -1;
    vector[secondaryIndex] += secondarySign * 0.35;
  }

  normalizeVector(vector);
  return vector;
}

function normalizeVector(vector: Float32Array): void {
  let sumSquares = 0;
  for (const value of vector) {
    sumSquares += value * value;
  }

  const norm = Math.sqrt(sumSquares);
  if (norm === 0) {
    vector[0] = 1;
    return;
  }

  for (let index = 0; index < vector.length; index += 1) {
    vector[index] /= norm;
  }
}

function tokenize(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9_:-]+/gu) ?? [];
}

function cosineSimilarity(left: Float32Array, right: Float32Array): number {
  const length = Math.min(left.length, right.length);
  let dot = 0;

  for (let index = 0; index < length; index += 1) {
    dot += left[index] * right[index];
  }

  return dot;
}

function vectorScoreFromCosine(cosine: number): number {
  return clamp01((cosine + 1) / 2);
}

function vectorScoreFromRedisDistance(distance: number): number {
  // RediSearch COSINE distance is lower-is-better. Normalize the common 0..2
  // cosine-distance range into a higher-is-better 0..1 score.
  return clamp01(1 - distance / 2);
}

function clamp01(value: number): number {
  if (Number.isNaN(value)) {
    return 0;
  }

  return Math.max(0, Math.min(1, value));
}

function lexicalScore(query: string, text: string): number {
  const queryTokens = [...new Set(tokenize(query))];
  if (queryTokens.length === 0) {
    return 0;
  }

  const haystack = text.toLowerCase();
  const textTokens = new Set(tokenize(text));
  const tokenMatches = queryTokens.filter((token) => textTokens.has(token)).length;
  const substringBoost = haystack.includes(query.trim().toLowerCase()) ? 0.2 : 0;

  return clamp01(tokenMatches / queryTokens.length + substringBoost);
}

function combinedScore(vectorScore: number, lexical: number, options: AttackKbSemanticContextSearchOptions): number {
  const vectorWeight = options.vectorWeight ?? DEFAULT_VECTOR_WEIGHT;
  const lexicalWeight = options.lexicalWeight ?? DEFAULT_LEXICAL_WEIGHT;
  const totalWeight = vectorWeight + lexicalWeight;

  if (totalWeight <= 0) {
    return vectorScore;
  }

  return clamp01((vectorScore * vectorWeight + lexical * lexicalWeight) / totalWeight);
}

function readStringProperty(value: unknown, property: string): string | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const raw = (value as Record<string, unknown>)[property];
  return typeof raw === "string" && raw.trim() ? raw.trim() : undefined;
}

function readNestedStringProperty(value: unknown, parent: string, property: string): string | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  return readStringProperty((value as Record<string, unknown>)[parent], property);
}

function extractStatus(object: AttackKbCanonicalObject): string | undefined {
  return readStringProperty(object.payload, "status") ?? readStringProperty(object.payload, "action");
}

function extractSourceCategory(object: AttackKbCanonicalObject): string | undefined {
  return (
    readStringProperty(object.payload, "category") ??
    readStringProperty(object.payload, "sourceCategory") ??
    readNestedStringProperty(object.payload, "provenance", "category")
  );
}

function compactLines(lines: Array<string | undefined | false>): string[] {
  return lines
    .filter((line): line is string => typeof line === "string" && line.trim().length > 0)
    .map((line) => line.trim());
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? "null";
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return `[unserializable payload: ${message}]`;
  }
}

function payloadSpecificLines(object: AttackKbCanonicalObject): string[] {
  const payload = object.payload as Record<string, unknown>;

  switch (object.objectType) {
    case "domain_decision_factor":
      return compactLines([
        `Decision factor: ${readStringProperty(payload, "label")}`,
        `Factor name: ${readStringProperty(payload, "name")}`,
        `Factor status: ${readStringProperty(payload, "status")}`,
      ]);
    case "recon_probe":
      return compactLines([
        `Recon probe factors: ${(payload.factorRefs as string[] | undefined)?.join(", ")}`,
        `Expected findings: ${(payload.expectedFindings as string[] | undefined)?.join("; ")}`,
        `Safety boundary: ${readStringProperty(payload, "safetyBoundary")}`,
      ]);
    case "domain_scenario":
      return compactLines([
        `Domain scenario decision factors: ${(payload.decisionFactorRefs as string[] | undefined)?.join(", ")}`,
        `Scenario signals: ${(payload.scenarioSignals as string[] | undefined)?.join("; ")}`,
        `Expected safe observation: ${readStringProperty(payload, "expectedSafeObservation")}`,
      ]);
    case "business_attack_route":
      return compactLines([
        `Business route decision factors: ${(payload.decisionFactorRefs as string[] | undefined)?.join(", ")}`,
        `Domain scenario refs: ${(payload.scenarioRefs as string[] | undefined)?.join(", ")}`,
        `System pattern refs: ${(payload.systemPatternRefs as string[] | undefined)?.join(", ")}`,
        `Defensive objective: ${readStringProperty(payload, "defensiveObjective")}`,
      ]);
    case "system_attack_pattern":
      return compactLines([
        `System pattern defensive objective: ${readStringProperty(payload, "defensiveObjective")}`,
        `Safety boundary: ${readStringProperty(payload, "safetyBoundary")}`,
      ]);
    case "evidence_source":
      return compactLines([
        `Evidence source type: ${readStringProperty(payload, "sourceType")}`,
        `Evidence source URL: ${readStringProperty(payload, "url")}`,
        `Retrieved at: ${readStringProperty(payload, "retrievedAt")}`,
      ]);
    case "source_artifact":
      return compactLines([
        `Source category: ${readStringProperty(payload, "category")}`,
        `Source type: ${readStringProperty(payload, "sourceType")}`,
        `Publisher: ${readNestedStringProperty(payload, "provenance", "publisher")}`,
        `Origin: ${readNestedStringProperty(payload, "provenance", "originLabel")}`,
        `Evidence: ${safeJson(payload.evidence)}`,
      ]);
    case "ingested_data_item":
      return compactLines([
        `Ingested data type: ${readStringProperty(payload, "dataType")}`,
        `Source ref: ${readStringProperty(payload, "sourceRef")}`,
        `Content: ${readStringProperty(payload, "content")}`,
        `Evidence: ${safeJson(payload.evidence)}`,
      ]);
    case "curation_candidate":
      return compactLines([
        `Curation status: ${readStringProperty(payload, "status")}`,
        `Candidate source category: ${readStringProperty(payload, "sourceCategory")}`,
        `Suggested object types: ${(payload.suggestedObjectTypes as string[] | undefined)?.join(", ")}`,
        `Reason: ${readStringProperty(payload, "reason")}`,
      ]);
    case "curation_review_decision":
      return compactLines([
        `Review action: ${readStringProperty(payload, "action")}`,
        `Review mode: ${readStringProperty(payload, "mode")}`,
        `Rationale: ${readStringProperty(payload, "rationale")}`,
        `Persisted refs: ${safeJson(payload.persistedObjectRefs)}`,
      ]);
    case "success_signal":
      return compactLines([`Observable outcome/success signal: ${readStringProperty(payload, "observable")}`]);
    default:
      return [];
  }
}

export function materializeAttackKbObjectText(object: AttackKbCanonicalObject): string {
  return compactLines([
    `Attack KB object ${object.id}`,
    `Type: ${object.objectType}`,
    object.domain ? `Domain: ${object.domain}` : undefined,
    `Title: ${object.title}`,
    object.description ? `Description: ${object.description}` : undefined,
    object.tags.length > 0 ? `Tags: ${object.tags.join(", ")}` : undefined,
    object.sourceRefs.length > 0 ? `Source refs: ${object.sourceRefs.join(", ")}` : undefined,
    extractStatus(object) ? `Status: ${extractStatus(object)}` : undefined,
    extractSourceCategory(object) ? `Source category: ${extractSourceCategory(object)}` : undefined,
    ...payloadSpecificLines(object),
    `Canonical payload: ${safeJson(object.payload)}`,
    `Updated at: ${object.updatedAt}`,
  ]).join("\n");
}

function splitTextIntoChunks(text: string, maxChunkChars: number): string[] {
  const maxChars = Math.max(400, maxChunkChars);
  if (text.length <= maxChars) {
    return [text];
  }

  const paragraphs = text.split(/\n{2,}/u);
  const chunks: string[] = [];
  let current = "";

  function pushCurrent(): void {
    if (current.trim()) {
      chunks.push(current.trim());
      current = "";
    }
  }

  for (const paragraph of paragraphs) {
    if (paragraph.length > maxChars) {
      pushCurrent();
      for (let cursor = 0; cursor < paragraph.length; cursor += maxChars) {
        chunks.push(paragraph.slice(cursor, cursor + maxChars).trim());
      }
      continue;
    }

    const next = current ? `${current}\n\n${paragraph}` : paragraph;
    if (next.length > maxChars) {
      pushCurrent();
      current = paragraph;
    } else {
      current = next;
    }
  }

  pushCurrent();
  return chunks;
}

export function chunkAttackKbObjectForRetrieval(
  object: AttackKbCanonicalObject,
  options: Pick<AttackKbVectorRetrievalConfig, "maxChunkChars"> = { maxChunkChars: DEFAULT_MAX_CHUNK_CHARS },
): AttackKbRetrievalChunk[] {
  const materialized = materializeAttackKbObjectText(object);
  const status = extractStatus(object);
  const sourceCategory = extractSourceCategory(object);

  return splitTextIntoChunks(materialized, options.maxChunkChars).map((text, index) => ({
    id: `${object.id}#${index}`,
    objectId: object.id,
    chunkOrdinal: index,
    objectType: object.objectType,
    domain: object.domain,
    status,
    sourceCategory,
    title: object.title,
    text,
    tags: object.tags,
    sourceRefs: object.sourceRefs,
    updatedAt: object.updatedAt,
  }));
}

function filterValues<T extends string>(value: T | T[] | undefined): T[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  return Array.isArray(value) ? value : [value];
}

function valueMatchesFilter(value: string | undefined, filter: string | string[] | undefined): boolean {
  const values = filterValues(filter);
  if (!values || values.length === 0) {
    return true;
  }

  return value !== undefined && values.includes(value);
}

function matchesSemanticFilters(
  object: AttackKbCanonicalObject,
  filters: AttackKbSemanticContextFilters,
): boolean {
  if (filters.ids && !filters.ids.includes(object.id)) {
    return false;
  }

  if (!valueMatchesFilter(object.domain, filters.domain)) {
    return false;
  }

  if (!valueMatchesFilter(object.objectType, filters.objectType)) {
    return false;
  }

  if (!valueMatchesFilter(extractStatus(object), filters.status)) {
    return false;
  }

  if (!valueMatchesFilter(extractSourceCategory(object), filters.sourceCategory)) {
    return false;
  }

  return true;
}

function storageQueryForFilters(filters: AttackKbSemanticContextFilters): AttackKbStorageQuery {
  const query: AttackKbStorageQuery = {};

  if (filters.ids) {
    query.ids = filters.ids;
  }
  if (typeof filters.domain === "string") {
    query.domain = filters.domain;
  }
  if (typeof filters.objectType === "string") {
    query.objectType = filters.objectType;
  }

  return query;
}

async function listFilteredObjects(
  storage: AttackKbStorageAdapter,
  filters: AttackKbSemanticContextFilters,
): Promise<AttackKbCanonicalObject[]> {
  const objects = await storage.list(storageQueryForFilters(filters));
  return objects.filter((object) => matchesSemanticFilters(object, filters));
}

function ensureEmbeddingDimensions(provider: AttackKbEmbeddingProvider, expectedDimensions: number): void {
  if (provider.dimensions !== expectedDimensions) {
    throw new Error(
      `Attack KB embedding dimension mismatch: provider ${provider.name} returns ${provider.dimensions}, index expects ${expectedDimensions}.`,
    );
  }
}

async function localSemanticSearch(
  query: string,
  filters: AttackKbSemanticContextFilters,
  options: AttackKbSemanticContextSearchOptions,
  config: AttackKbVectorRetrievalConfig,
  fallbackReason?: string,
): Promise<AttackKbSemanticContextSearchResponse> {
  const storage = options.storage ?? getDefaultAttackKbStorageAdapter();
  const provider = resolveEmbeddingProvider(options, config);
  ensureEmbeddingDimensions(provider, config.embedding.dimensions);

  const queryVector = await provider.embed(query);
  const objects = await listFilteredObjects(storage, filters);
  const results: AttackKbSemanticContextResult[] = [];

  for (const object of objects) {
    for (const chunk of chunkAttackKbObjectForRetrieval(object, config)) {
      const chunkVector = await provider.embed(chunk.text);
      const vectorScore = vectorScoreFromCosine(cosineSimilarity(queryVector, chunkVector));
      const lexical = lexicalScore(query, chunk.text);
      const score = combinedScore(vectorScore, lexical, options);

      if (score < (options.minScore ?? 0)) {
        continue;
      }

      results.push({
        object,
        chunk,
        score,
        vectorScore,
        lexicalScore: lexical,
        backend: "local",
      });
    }
  }

  const limit = options.limit ?? 10;
  results.sort((left, right) => right.score - left.score || left.chunk.id.localeCompare(right.chunk.id));

  return {
    query,
    filters,
    generatedAt: new Date().toISOString(),
    backend: "local",
    embeddingProvider: provider.name,
    dimensions: provider.dimensions,
    fallbackReason,
    results: results.slice(0, limit),
  };
}

function vectorKeyPrefix(config: AttackKbVectorRetrievalConfig): string {
  return config.redis.keyPrefix;
}

function vectorChunkKey(config: AttackKbVectorRetrievalConfig, objectId: string, chunkOrdinal: number): string {
  return `${vectorKeyPrefix(config)}:chunk:${objectId}:${chunkOrdinal}`;
}

function objectChunksSetKey(config: AttackKbVectorRetrievalConfig, objectId: string): string {
  return `${vectorKeyPrefix(config)}:object-chunks:${objectId}`;
}

function float32ArrayToBuffer(vector: Float32Array): Buffer {
  const buffer = Buffer.alloc(vector.length * 4);

  for (let index = 0; index < vector.length; index += 1) {
    buffer.writeFloatLE(vector[index], index * 4);
  }

  return buffer;
}

async function sendRedisCommand(client: AttackKbRedisClient, command: RedisCommandArgument[]): Promise<unknown> {
  const sendCommand = client.sendCommand as unknown as (
    this: AttackKbRedisClient,
    args: RedisCommandArgument[],
  ) => Promise<unknown>;
  return sendCommand.call(client, command);
}

function isMissingIndexError(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return message.includes("unknown index") || message.includes("no such index") || message.includes("not found");
}

function isIndexAlreadyExistsError(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return message.includes("index already exists") || message.includes("index name is busy");
}

function safeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/redis(s)?:\/\/\S+/giu, "[redacted-redis-url]");
}

function warnRedisFallback(reason: string): void {
  if (warnedAboutRedisFallback) {
    return;
  }

  process.emitWarning(`Attack KB vector retrieval falling back to deterministic local search: ${reason}`, {
    code: "ATTACK_KB_VECTOR_REDIS_FALLBACK",
  });
  warnedAboutRedisFallback = true;
}

export function buildAttackKbVectorIndexSchema(
  config: AttackKbVectorRetrievalConfig = getAttackKbVectorRetrievalConfig(),
): AttackKbVectorIndexSchema {
  const prefix = `${vectorKeyPrefix(config)}:chunk:`;
  const vectorArgs = [
    "VECTOR",
    config.redis.indexAlgorithm,
    "6",
    "TYPE",
    "FLOAT32",
    "DIM",
    String(config.embedding.dimensions),
    "DISTANCE_METRIC",
    "COSINE",
  ];
  const ftCreateCommand = [
    "FT.CREATE",
    config.redis.indexName,
    "ON",
    "HASH",
    "PREFIX",
    "1",
    prefix,
    "SCHEMA",
    "objectId",
    "TAG",
    "chunkId",
    "TAG",
    "chunkOrdinal",
    "NUMERIC",
    "SORTABLE",
    "objectType",
    "TAG",
    "domain",
    "TAG",
    "status",
    "TAG",
    "sourceCategory",
    "TAG",
    "title",
    "TEXT",
    "WEIGHT",
    "2.0",
    "text",
    "TEXT",
    "tags",
    "TAG",
    "SEPARATOR",
    ",",
    "sourceRefs",
    "TAG",
    "SEPARATOR",
    ",",
    "updatedAt",
    "TEXT",
    "embedding",
    ...vectorArgs,
  ];

  return {
    indexName: config.redis.indexName,
    keyPrefix: vectorKeyPrefix(config),
    documentKeyPattern: `${prefix}<objectId>:<chunkOrdinal>`,
    algorithm: config.redis.indexAlgorithm,
    dimensions: config.embedding.dimensions,
    distanceMetric: "COSINE",
    fields: [
      { name: "objectId", kind: "TAG", note: "canonical Attack KB object id" },
      { name: "chunkId", kind: "TAG", note: "stable <objectId>#<ordinal> chunk id" },
      { name: "chunkOrdinal", kind: "NUMERIC", note: "chunk order within canonical object" },
      { name: "objectType", kind: "TAG", note: "canonical storage object type filter" },
      { name: "domain", kind: "TAG", note: "domain filter, e.g. credit_loan" },
      { name: "status", kind: "TAG", note: "status/action metadata when present" },
      { name: "sourceCategory", kind: "TAG", note: "OWASP/MITRE/NIST/vendor/manual category when present" },
      { name: "title", kind: "TEXT", note: "weighted title text" },
      { name: "text", kind: "TEXT", note: "materialized canonical object retrieval text" },
      { name: "tags", kind: "TAG", note: "comma-separated canonical tags" },
      { name: "sourceRefs", kind: "TAG", note: "comma-separated source refs" },
      { name: "updatedAt", kind: "TEXT", note: "canonical object timestamp" },
      { name: "embedding", kind: "VECTOR", note: `${config.redis.indexAlgorithm} FLOAT32/${config.embedding.dimensions}/COSINE` },
    ],
    ftCreateCommand,
  };
}

export async function createAttackKbVectorIndex(
  client: AttackKbRedisClient,
  config: AttackKbVectorRetrievalConfig = getAttackKbVectorRetrievalConfig(),
): Promise<AttackKbVectorIndexSchema> {
  const schema = buildAttackKbVectorIndexSchema(config);

  try {
    await sendRedisCommand(client, ["FT.INFO", config.redis.indexName]);
    return schema;
  } catch (error) {
    if (!isMissingIndexError(error)) {
      throw error;
    }
  }

  try {
    await sendRedisCommand(client, schema.ftCreateCommand);
  } catch (error) {
    if (!isIndexAlreadyExistsError(error)) {
      throw error;
    }
  }

  return schema;
}

function tagFieldValue(value: string | undefined): string {
  return value?.trim() || MISSING_TAG_VALUE;
}

async function redisSmembers(client: AttackKbRedisClient, key: string): Promise<string[]> {
  const response = await sendRedisCommand(client, ["SMEMBERS", key]);
  return Array.isArray(response) ? response.map(String) : [];
}

async function redisDel(client: AttackKbRedisClient, keys: string[]): Promise<void> {
  if (keys.length === 0) {
    return;
  }

  await sendRedisCommand(client, ["DEL", ...keys]);
}

async function redisSadd(client: AttackKbRedisClient, key: string, members: string[]): Promise<void> {
  if (members.length === 0) {
    return;
  }

  await sendRedisCommand(client, ["SADD", key, ...members]);
}

async function materializeObjectChunksToRedis(
  client: AttackKbRedisClient,
  object: AttackKbCanonicalObject,
  provider: AttackKbEmbeddingProvider,
  config: AttackKbVectorRetrievalConfig,
): Promise<number> {
  const chunks = chunkAttackKbObjectForRetrieval(object, config);
  const setKey = objectChunksSetKey(config, object.id);
  const staleKeys = await redisSmembers(client, setKey);
  await redisDel(client, staleKeys);
  await redisDel(client, [setKey]);

  const nextKeys: string[] = [];

  for (const chunk of chunks) {
    const key = vectorChunkKey(config, object.id, chunk.chunkOrdinal);
    const embedding = await provider.embed(chunk.text);
    ensureEmbeddingDimensions(provider, config.embedding.dimensions);

    await sendRedisCommand(client, [
      "HSET",
      key,
      "schemaVersion",
      "1",
      "objectId",
      object.id,
      "chunkId",
      chunk.id,
      "chunkOrdinal",
      String(chunk.chunkOrdinal),
      "objectType",
      object.objectType,
      "domain",
      tagFieldValue(object.domain),
      "status",
      tagFieldValue(chunk.status),
      "sourceCategory",
      tagFieldValue(chunk.sourceCategory),
      "title",
      object.title,
      "text",
      chunk.text,
      "tags",
      object.tags.join(","),
      "sourceRefs",
      object.sourceRefs.join(","),
      "updatedAt",
      object.updatedAt,
      "embedding",
      float32ArrayToBuffer(embedding),
    ]);

    nextKeys.push(key);
  }

  await redisSadd(client, setKey, nextKeys);
  return chunks.length;
}

async function openRedisClient(
  config: AttackKbVectorRetrievalConfig,
  providedClient?: AttackKbRedisClient,
): Promise<{ client: AttackKbRedisClient; close: () => Promise<void> }> {
  if (providedClient) {
    return { client: providedClient, close: async () => undefined };
  }

  if (!config.redis.url) {
    throw new Error("Attack KB vector Redis backend is selected but no Redis URL is configured.");
  }

  const client = createAttackKbRedisClient({ url: config.redis.url });
  await client.connect();

  return {
    client,
    async close() {
      const maybeClient = client as unknown as {
        isOpen?: boolean;
        close?: () => Promise<void>;
        destroy?: () => void;
      };

      if (maybeClient.isOpen === false) {
        return;
      }

      const closePromise = maybeClient.close?.();
      if (!closePromise) {
        return;
      }

      await closePromise.catch(() => {
        maybeClient.destroy?.();
      });
    },
  };
}

export async function indexAttackKbSemanticContext(
  options: AttackKbSemanticIndexingOptions = {},
): Promise<AttackKbSemanticIndexingResult> {
  const config = options.config ?? getAttackKbVectorRetrievalConfig();
  const storage = options.storage ?? getDefaultAttackKbStorageAdapter();
  const provider = resolveEmbeddingProvider(options, config);
  ensureEmbeddingDimensions(provider, config.embedding.dimensions);

  const { client, close } = await openRedisClient(config, options.redisClient);

  try {
    const schema = await createAttackKbVectorIndex(client, config);
    const objects = options.objects ?? (await storage.list({}));
    let chunksIndexed = 0;

    for (const object of objects) {
      chunksIndexed += await materializeObjectChunksToRedis(client, object, provider, config);
    }

    return {
      backend: "redis",
      indexName: config.redis.indexName,
      keyPrefix: vectorKeyPrefix(config),
      embeddingProvider: provider.name,
      dimensions: provider.dimensions,
      objectsIndexed: objects.length,
      chunksIndexed,
      schema,
    };
  } finally {
    await close();
  }
}

function escapeRedisTagValue(value: string): string {
  return value.replace(/([,.<>{}\[\]"':;!@#$%^&*()\-+=~\\|\s])/gu, "\\$1");
}

function redisTagFilter(field: string, value: string | string[] | undefined): string | undefined {
  const values = filterValues(value);
  if (!values || values.length === 0) {
    return undefined;
  }

  return `@${field}:{${values.map(escapeRedisTagValue).join("|")}}`;
}

function buildRedisFilterQuery(filters: AttackKbSemanticContextFilters): string {
  const clauses = compactLines([
    redisTagFilter("objectId", filters.ids),
    redisTagFilter("domain", filters.domain),
    redisTagFilter("objectType", filters.objectType),
    redisTagFilter("status", filters.status),
    redisTagFilter("sourceCategory", filters.sourceCategory),
  ]);

  if (clauses.length === 0) {
    return "*";
  }

  return `(${clauses.join(" ")})`;
}

function parseRedisSearchFields(value: unknown): Record<string, string> {
  if (!Array.isArray(value)) {
    return {};
  }

  const fields: Record<string, string> = {};
  for (let index = 0; index < value.length - 1; index += 2) {
    fields[String(value[index])] = String(value[index + 1]);
  }

  return fields;
}

function parseRedisSearchRows(response: unknown): RedisSearchRow[] {
  if (!Array.isArray(response)) {
    return [];
  }

  const rows: RedisSearchRow[] = [];
  for (let index = 1; index < response.length - 1; index += 2) {
    rows.push({
      key: String(response[index]),
      fields: parseRedisSearchFields(response[index + 1]),
    });
  }

  return rows;
}

function optionalTagValue(value: string | undefined): string | undefined {
  return value && value !== MISSING_TAG_VALUE ? value : undefined;
}

async function redisSemanticSearch(
  query: string,
  filters: AttackKbSemanticContextFilters,
  options: AttackKbSemanticContextSearchOptions,
  config: AttackKbVectorRetrievalConfig,
): Promise<AttackKbSemanticContextSearchResponse> {
  const storage = options.storage ?? getDefaultAttackKbStorageAdapter();
  const provider = resolveEmbeddingProvider(options, config);
  ensureEmbeddingDimensions(provider, config.embedding.dimensions);

  const { client, close } = await openRedisClient(config, options.redisClient);

  try {
    if (options.materialize ?? config.redis.materializeOnSearch) {
      const objects = await storage.list({});
      await indexAttackKbSemanticContext({ storage, config, embeddingProvider: provider, redisClient: client, objects });
    } else {
      await createAttackKbVectorIndex(client, config);
    }

    const limit = options.limit ?? 10;
    const topK = options.topK ?? Math.max(limit * 4, 20);
    const queryVector = await provider.embed(query);
    const redisQuery = `${buildRedisFilterQuery(filters)}=>[KNN ${topK} @embedding $query_vector AS vector_distance]`;
    const response = await sendRedisCommand(client, [
      "FT.SEARCH",
      config.redis.indexName,
      redisQuery,
      "PARAMS",
      "2",
      "query_vector",
      float32ArrayToBuffer(queryVector),
      "SORTBY",
      "vector_distance",
      "ASC",
      "RETURN",
      "13",
      "objectId",
      "chunkId",
      "chunkOrdinal",
      "objectType",
      "domain",
      "status",
      "sourceCategory",
      "title",
      "text",
      "tags",
      "sourceRefs",
      "updatedAt",
      "vector_distance",
      "LIMIT",
      "0",
      String(topK),
      "DIALECT",
      "2",
    ]);

    const results: AttackKbSemanticContextResult[] = [];

    for (const row of parseRedisSearchRows(response)) {
      const objectId = row.fields.objectId;
      if (!objectId) {
        continue;
      }

      const object = await storage.get(objectId);
      if (!object || !matchesSemanticFilters(object, filters)) {
        continue;
      }

      const distance = Number(row.fields.vector_distance ?? row.fields.__vector_score);
      const vectorScore = vectorScoreFromRedisDistance(Number.isFinite(distance) ? distance : 2);
      const text = row.fields.text ?? materializeAttackKbObjectText(object);
      const lexical = lexicalScore(query, text);
      const score = combinedScore(vectorScore, lexical, options);

      if (score < (options.minScore ?? 0)) {
        continue;
      }

      results.push({
        object,
        chunk: {
          id: row.fields.chunkId || `${objectId}#${row.fields.chunkOrdinal || "0"}`,
          objectId,
          chunkOrdinal: Number(row.fields.chunkOrdinal ?? 0),
          objectType: object.objectType,
          domain: object.domain,
          status: optionalTagValue(row.fields.status) ?? extractStatus(object),
          sourceCategory: optionalTagValue(row.fields.sourceCategory) ?? extractSourceCategory(object),
          title: row.fields.title || object.title,
          text,
          tags: row.fields.tags ? row.fields.tags.split(",").filter(Boolean) : object.tags,
          sourceRefs: row.fields.sourceRefs ? row.fields.sourceRefs.split(",").filter(Boolean) : object.sourceRefs,
          updatedAt: row.fields.updatedAt || object.updatedAt,
        },
        score,
        vectorScore,
        lexicalScore: lexical,
        backend: "redis",
        redisDistance: Number.isFinite(distance) ? distance : undefined,
      });
    }

    results.sort((left, right) => right.score - left.score || left.chunk.id.localeCompare(right.chunk.id));

    return {
      query,
      filters,
      generatedAt: new Date().toISOString(),
      backend: "redis",
      embeddingProvider: provider.name,
      dimensions: provider.dimensions,
      indexName: config.redis.indexName,
      keyPrefix: vectorKeyPrefix(config),
      results: results.slice(0, limit),
    };
  } finally {
    await close();
  }
}

function shouldUseRedis(config: AttackKbVectorRetrievalConfig): boolean {
  if (config.backend === "redis") {
    return true;
  }

  return config.backend === "auto" && Boolean(config.redis.url);
}

export async function searchAttackKbSemanticContext(
  query: string,
  filters: AttackKbSemanticContextFilters = {},
  options: AttackKbSemanticContextSearchOptions = {},
): Promise<AttackKbSemanticContextSearchResponse> {
  const config = options.config ?? getAttackKbVectorRetrievalConfig();

  if (!query.trim()) {
    throw new Error("searchAttackKbSemanticContext requires a non-empty query.");
  }

  if (!shouldUseRedis(config)) {
    return localSemanticSearch(query, filters, options, config);
  }

  try {
    return await redisSemanticSearch(query, filters, options, config);
  } catch (error) {
    const reason = safeErrorMessage(error);
    if (!config.redis.fallbackToLocal) {
      throw new Error(`Attack KB Redis vector retrieval failed and fallback is disabled: ${reason}`);
    }

    warnRedisFallback(reason);
    return localSemanticSearch(query, filters, options, config, reason);
  }
}
