import type { AttackKbCanonicalObject } from "../types.js";
import type { AttackKbStorageQuery } from "./types.js";

export function matchesAttackKbStorageQuery(
  object: AttackKbCanonicalObject,
  query: AttackKbStorageQuery,
): boolean {
  if (query.objectType && object.objectType !== query.objectType) {
    return false;
  }

  if (query.domain && object.domain !== query.domain) {
    return false;
  }

  if (query.ids && !query.ids.includes(object.id)) {
    return false;
  }

  if (query.text) {
    const needle = query.text.toLowerCase();
    const haystack = [
      object.id,
      object.objectType,
      object.domain,
      object.title,
      object.description,
      object.tags.join(" "),
      JSON.stringify(object.payload),
    ]
      .filter(Boolean)
      .join("\n")
      .toLowerCase();

    if (!haystack.includes(needle)) {
      return false;
    }
  }

  return true;
}
