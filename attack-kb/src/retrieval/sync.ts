import "dotenv/config";

import { indexAttackKbSemanticContext } from "./semantic.js";
import { createAttackKbStorageAdapter, getAttackKbStorageConfig } from "../storage/index.js";

const storage = createAttackKbStorageAdapter(getAttackKbStorageConfig());

try {
  const result = await indexAttackKbSemanticContext({ storage });
  console.log(JSON.stringify({ ok: true, ...result }, null, 2));
} finally {
  await storage.close?.();
}
