import "dotenv/config";

import { createAttackKbStorageAdapter, getAttackKbStorageConfig } from "../storage/index.js";
import { writeContextProjection } from "../source-pipeline/curator-storage.js";
import type { AttackKbCanonicalObject, AttackKbStorageObjectType } from "../types.js";

const CONTEXT_SURFACE_OBJECT_TYPES: AttackKbStorageObjectType[] = [
  "vulnerability",
  "attack_pattern",
  "system_attack_pattern",
  "payload_template",
  "delivery_mode",
  "success_signal",
  "evidence_source",
  "source_artifact",
  "ingested_data_item",
  "domain_decision_factor",
  "recon_probe",
  "domain_scenario",
  "business_attack_route",
];

const config = getAttackKbStorageConfig();
const storage = createAttackKbStorageAdapter({ ...config, seedOnEmpty: false });

try {
  const objects = await storage.list({ limit: 5_000 });
  const byId = new Map<string, AttackKbCanonicalObject>();
  for (const object of objects) {
    if (CONTEXT_SURFACE_OBJECT_TYPES.includes(object.objectType)) {
      byId.set(object.id, object);
    }
  }

  const projected = [];
  for (const object of byId.values()) {
    const key = await writeContextProjection(object);
    if (key) {
      projected.push({ id: object.id, objectType: object.objectType, key });
    }
  }

  const counts = projected.reduce<Record<string, number>>((acc, item) => {
    acc[item.objectType] = (acc[item.objectType] ?? 0) + 1;
    return acc;
  }, {});

  console.log(JSON.stringify({
    ok: true,
    projected: projected.length,
    counts,
    sample: projected.slice(0, 12),
  }, null, 2));
} finally {
  await storage.close?.();
}
