export const ATTACK_KB_REDIS_STREAMS = {
  sourceIngested: "attack-kb:source-ingested",
  curationCandidateCreated: "attack-kb:curation-candidate-created",
  autoReviewRequested: "attack-kb:auto-review-requested",
  recommendationRequested: "attack-kb:recommendation-requested",
  deliveryOutcomeReported: "attack-kb:delivery-outcome-reported",
  evalRunCompleted: "attack-kb:eval-run-completed",
  curationReviewDecisionCreated: "attack-kb:curation-review-decision-created",
} as const;

export type AttackKbRedisStreamName = (typeof ATTACK_KB_REDIS_STREAMS)[keyof typeof ATTACK_KB_REDIS_STREAMS];

export type AttackKbStreamEventType =
  | "source_ingested"
  | "data_item_ingested"
  | "curation_candidate_created"
  | "auto_review_requested"
  | "curation_review_decision_created"
  | "recommendation_requested"
  | "delivery_outcome_reported"
  | "eval_run_completed";

export type AttackKbStreamPayload = unknown;

export type AttackKbStreamEvent<TPayload = AttackKbStreamPayload> = {
  stream: AttackKbRedisStreamName;
  timestamp: string;
  type: AttackKbStreamEventType;
  source: string;
  payload: TPayload;
};

export type AttackKbRedisStreamFields = {
  schema_version: "1";
  timestamp: string;
  type: AttackKbStreamEventType;
  source: string;
  payload: string;
};

export type AttackKbRedisStreamWriter = {
  append(
    stream: AttackKbRedisStreamName,
    fields: AttackKbRedisStreamFields,
    event: AttackKbStreamEvent,
  ): Promise<string | void>;
};

export type AttackKbRecordStreamEventInput<TPayload = AttackKbStreamPayload> = {
  type: AttackKbStreamEventType;
  source: string;
  payload?: TPayload;
  stream?: AttackKbRedisStreamName;
  timestamp?: string;
};

export type AttackKbRecordStreamEventOptions = {
  writer?: AttackKbRedisStreamWriter;
};

export type AttackKbRecordedStreamEvent = AttackKbStreamEvent & {
  recordedTo: "redis" | "local-array";
  streamId?: string;
  fallbackReason?: string;
};

const DEFAULT_MAX_LOCAL_EVENTS = 500;

export const ATTACK_KB_STREAM_BY_EVENT_TYPE = {
  source_ingested: ATTACK_KB_REDIS_STREAMS.sourceIngested,
  data_item_ingested: ATTACK_KB_REDIS_STREAMS.sourceIngested,
  curation_candidate_created: ATTACK_KB_REDIS_STREAMS.curationCandidateCreated,
  auto_review_requested: ATTACK_KB_REDIS_STREAMS.autoReviewRequested,
  curation_review_decision_created: ATTACK_KB_REDIS_STREAMS.curationReviewDecisionCreated,
  recommendation_requested: ATTACK_KB_REDIS_STREAMS.recommendationRequested,
  delivery_outcome_reported: ATTACK_KB_REDIS_STREAMS.deliveryOutcomeReported,
  eval_run_completed: ATTACK_KB_REDIS_STREAMS.evalRunCompleted,
} as const satisfies Record<AttackKbStreamEventType, AttackKbRedisStreamName>;

let configuredWriter: AttackKbRedisStreamWriter | undefined;
const localStreamEvents: AttackKbRecordedStreamEvent[] = [];

function eventTimestamp(timestamp: string | undefined): string {
  return timestamp ?? new Date().toISOString();
}

function stringifyPayload(payload: AttackKbStreamPayload): string {
  try {
    return JSON.stringify(payload) ?? "{}";
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return JSON.stringify({
      serializationError: message,
      note: "Attack KB stream payload could not be serialized; original event was kept in local memory only.",
    }) ?? "{}";
  }
}

function rememberLocalEvent(
  event: AttackKbStreamEvent,
  fallbackReason = "no_redis_stream_writer_configured",
): AttackKbRecordedStreamEvent {
  const recorded: AttackKbRecordedStreamEvent = {
    ...event,
    recordedTo: "local-array",
    fallbackReason,
  };

  localStreamEvents.push(recorded);
  while (localStreamEvents.length > DEFAULT_MAX_LOCAL_EVENTS) {
    localStreamEvents.shift();
  }

  return recorded;
}

export function setAttackKbRedisStreamWriter(writer: AttackKbRedisStreamWriter | undefined): void {
  configuredWriter = writer;
}

export function getAttackKbStreamNameForType(type: AttackKbStreamEventType): AttackKbRedisStreamName {
  return ATTACK_KB_STREAM_BY_EVENT_TYPE[type];
}

export function getLocalAttackKbStreamEvents(): AttackKbRecordedStreamEvent[] {
  return [...localStreamEvents];
}

export function clearLocalAttackKbStreamEvents(): void {
  localStreamEvents.length = 0;
}

export function toRedisStreamFields(event: AttackKbStreamEvent): AttackKbRedisStreamFields {
  return {
    schema_version: "1",
    timestamp: event.timestamp,
    type: event.type,
    source: event.source,
    payload: stringifyPayload(event.payload),
  };
}

export async function recordAttackKbEvent<TPayload = AttackKbStreamPayload>(
  input: AttackKbRecordStreamEventInput<TPayload>,
  options: AttackKbRecordStreamEventOptions = {},
): Promise<AttackKbRecordedStreamEvent> {
  const event: AttackKbStreamEvent<TPayload> = {
    stream: input.stream ?? getAttackKbStreamNameForType(input.type),
    timestamp: eventTimestamp(input.timestamp),
    type: input.type,
    source: input.source,
    payload: input.payload ?? ({} as TPayload),
  };
  const writer = options.writer ?? configuredWriter;

  if (!writer) {
    return rememberLocalEvent(event);
  }

  try {
    const streamId = await writer.append(event.stream, toRedisStreamFields(event), event);
    return {
      ...event,
      recordedTo: "redis",
      streamId: typeof streamId === "string" ? streamId : undefined,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return rememberLocalEvent(event, `redis_stream_write_failed: ${message}`);
  }
}
