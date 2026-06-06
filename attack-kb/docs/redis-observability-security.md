# Redis observability and security for Attack KB

This is the P0 Redis runbook for the Attack KB storage slice. It keeps Redis setup, reporting, and security guidance visible without giving live sandbox subagents direct access to Redis credentials.

## Configuration baseline

Use Redis Cloud or a local Redis Stack instance for the eventual Redis-backed adapter. Local storage remains the default until the concrete Redis client is wired.

Recommended env shape:

```bash
ATTACK_KB_STORAGE_ADAPTER=redis-iris
ATTACK_KB_REDIS_IRIS_URL=rediss://attack-kb-app:<password>@<host>:<port>/0
ATTACK_KB_REDIS_IRIS_INDEX=attack-kb-objects
ATTACK_KB_REDIS_IRIS_NAMESPACE=attack-kb
ATTACK_KB_REDIS_IRIS_FALLBACK=local

# Optional report/client naming overrides
ATTACK_KB_REDIS_KEY_PREFIX=attack-kb
ATTACK_KB_REDIS_EVENTS_STREAM=attack-kb:events
ATTACK_KB_REDIS_CURATION_STREAM=attack-kb:curation:events
```

Guidance:

- Prefer `rediss://` for Redis Cloud and any non-local deployment so TLS is on by default.
- Keep real credentials only in local `.env`, deployment secrets, or the final secret manager. Never commit credentials and never paste them into agent chat.
- Use an ACL user such as `attack-kb-app`, not the default/admin user, for the application client.
- Keep key names scoped under `ATTACK_KB_REDIS_KEY_PREFIX` / `ATTACK_KB_REDIS_IRIS_NAMESPACE` so cleanup and ACL patterns can target `attack-kb:*` without touching unrelated Redis data.
- Leave `ATTACK_KB_REDIS_IRIS_FALLBACK=local` for demos until the concrete Redis client from the storage-client slice is ready; use `disabled` only when final integration should fail fast on Redis issues.

## Scoped keys, indexes, and streams

The P0 key layout should stay boring and grep-able:

| Purpose | Intended name/pattern |
| --- | --- |
| Canonical object keys | `${ATTACK_KB_REDIS_KEY_PREFIX}:object:<objectType>:<id>` |
| Source artifacts | `${ATTACK_KB_REDIS_KEY_PREFIX}:object:source_artifact:<id>` |
| Ingested data items | `${ATTACK_KB_REDIS_KEY_PREFIX}:object:ingested_data_item:<id>` |
| Curation candidates | `${ATTACK_KB_REDIS_KEY_PREFIX}:object:curation_candidate:<id>` |
| RediSearch/Iris index | `ATTACK_KB_REDIS_IRIS_INDEX` (default `attack-kb-objects`) |
| General events stream | `ATTACK_KB_REDIS_EVENTS_STREAM` (default `${prefix}:events`) |
| Curation events stream | `ATTACK_KB_REDIS_CURATION_STREAM` (default `${prefix}:curation:events`) |

If the concrete #22 client chooses a different physical schema, it should still expose/report these logical names so demos, docs, ACLs, and final smoke reports stay aligned.

## Security rules

- Attack KB subagents must not receive raw Redis admin credentials. They can receive summaries, recommendations, or tool results from the Attack KB service boundary only.
- The app/runtime client should use a scoped Redis ACL user. Reserve admin credentials for provisioning and emergency maintenance outside the agent runtime.
- Prefer separate users for:
  - **app writes**: object read/write, index search/query, stream append/read for `attack-kb:*`;
  - **observability**: read-only diagnostics such as `INFO`, `SLOWLOG`, `MEMORY DOCTOR`, `FT.INFO`, and `FT.PROFILE`;
  - **admin**: provisioning only, not available to subagents or demo flows.
- Do not grant destructive commands (`FLUSHALL`, `FLUSHDB`, `CONFIG SET`, broad `KEYS`, ACL mutation) to the app user.
- Sanitize traces and reports: log whether a URL/user/password is configured, never the raw secret.

## Observability checklist

Use these during final integration or when diagnosing Redis behavior. Capture sanitized summaries for the demo/report; do not paste credentials or raw sensitive payloads. The examples use `--tls` for Redis Cloud/`rediss://`; drop `--tls` for a local non-TLS Redis Stack instance.

### Redis server health

```bash
redis-cli --tls -u "$ATTACK_KB_REDIS_IRIS_URL" INFO server
redis-cli --tls -u "$ATTACK_KB_REDIS_IRIS_URL" INFO memory
redis-cli --tls -u "$ATTACK_KB_REDIS_IRIS_URL" INFO stats
redis-cli --tls -u "$ATTACK_KB_REDIS_IRIS_URL" INFO commandstats
```

Look for connected clients, memory pressure, evictions, rejected connections, command latency, and module availability.

### Slow operations

```bash
redis-cli --tls -u "$ATTACK_KB_REDIS_IRIS_URL" SLOWLOG GET 20
```

Use this to catch expensive index queries or accidental scans. Keep the output sanitized because arguments may include KB text.

### Memory diagnostics

```bash
redis-cli --tls -u "$ATTACK_KB_REDIS_IRIS_URL" MEMORY DOCTOR
```

Use `MEMORY DOCTOR` for a plain-English check on fragmentation and memory pressure before the final demo.

### Search/index diagnostics

```bash
redis-cli --tls -u "$ATTACK_KB_REDIS_IRIS_URL" FT.INFO "$ATTACK_KB_REDIS_IRIS_INDEX"
redis-cli --tls -u "$ATTACK_KB_REDIS_IRIS_URL" FT.PROFILE "$ATTACK_KB_REDIS_IRIS_INDEX" SEARCH QUERY "*" LIMIT 0 5
```

`FT.INFO` should show document count, indexing status, and index memory. `FT.PROFILE` should be used with a tiny synthetic/safe query during final integration so the report can show query shape and timing without leaking payloads.

### Redis Insight

Redis Insight is useful for a judge-facing screenshot or a local debugging pass:

- verify the database is TLS/auth protected;
- inspect `attack-kb:*` key counts and stream lengths;
- inspect the RediSearch/Iris index (`attack-kb-objects` by default);
- review slowlog and memory panels.

Do not leave Redis Insight connected with admin credentials during subagent runs.

## Safe health/report command

Run the local report without contacting Redis:

```bash
npm run attack-kb:redis-health
```

The command prints sanitized config, intended keys/index/streams, observability commands, and a readiness block with `not_checked` status. It never prints raw credentials.

To add a minimal network readiness check, opt in explicitly:

```bash
ATTACK_KB_REDIS_HEALTH_CONNECT=1 npm run attack-kb:redis-health
```

That mode uses `ATTACK_KB_REDIS_IRIS_URL` only to perform `AUTH` when credentials are embedded in the URL, optional `SELECT` for the URL database path, and `PING`. It does not run `INFO`, `SLOWLOG`, `MEMORY DOCTOR`, `FT.INFO`, or `FT.PROFILE`; those remain manual/final-integration diagnostics.

## Final integration smoke/report approach

Bo requested tests only at final integration, so this slice should stay docs/report-only until the Redis client slice lands.

At final integration:

1. Run `npm run attack-kb:redis-health` and save the sanitized report.
2. Run `ATTACK_KB_REDIS_HEALTH_CONNECT=1 npm run attack-kb:redis-health` to confirm TLS/auth/PING reachability.
3. With the #22 Redis client wired, write/read one synthetic canonical object under the scoped prefix and confirm the recommendation path still uses the `AttackKbStorageAdapter` boundary.
4. Capture sanitized `INFO`, `SLOWLOG GET 20`, `MEMORY DOCTOR`, `FT.INFO`, and one tiny `FT.PROFILE` result.
5. Capture the W&B Weave trace link for the final demo flow and note whether Redis fallback was disabled or enabled.
6. Include a short report section: Redis endpoint sanitized, ACL user role, key prefix, index name, stream names, doc count, slowlog summary, memory status, and open risks.

## Open integration with #22 client

Current code keeps Redis Iris as an adapter boundary in `attack-kb/src/storage/redis-iris.ts`. The health/report script does not instantiate a Redis client and is intentionally safe to run before #22 lands. The #22 client should reuse the same env vars, logical names, and sanitization rules, then replace the stub behavior behind `AttackKbStorageAdapter` without changing the main recommendation flow.
