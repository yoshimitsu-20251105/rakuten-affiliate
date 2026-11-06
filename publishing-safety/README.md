# Publishing Safety Layer v1

`AUTO_PUBLISH=false` is a constant, not an enable switch. This module performs
private dry-runs only. It contains no browser executor, network connection,
credential discovery, note posting, content generation or experiment transition.
NOTE_NATIVE_MONETIZATION is excluded. Existing workflows are not wired to this CLI.

```sh
node publishing-safety/cli.js --request /private/request.json
```

Request: schemaVersion=1, purpose=AFFILIATE_MONETIZATION or
AFFILIATE_NOTE_ACQUISITION, isSynthetic, experimentId, candidateId, channel,
targetLP, contentUnit, variant, planId, content (existing draft only), optional
contentHash, dryRun (default true), browserProfile (opaque label or null),
plannerManifest and plannerReport `{path,sha256}`. Optional retryOfRunId requests
an explicit retry. No package scripts, daily workflow or publisher are modified.

The original Selector recommendation is verified through the existing Planner
input boundary. Planner is rerun read-only at the supplied/current asOf, checking
current concurrency, retry, counter evidence, LP hash, measurement and validity.
The saved READY plan, source hashes, selected candidate, plan fields and current
READY plan must agree. Zero recommendations, missing inputs, stale provenance,
changed content or unverified affiliate note measurement block the run. Raw CSV
attribution is not inferred. No metrics are fabricated.

All records include runId, experimentId, candidateId, channel, targetLP,
plannedAt, startedAt, finishedAt, contentHash, idempotencyKey, utmCampaign,
utmContent, affiliateMeasurementId, browserProfile, humanIntervention, retryCount,
errorReason, publishedUrl and finalStatus. Unknowns remain null. Raw content is
not persisted. browserProfile is metadata only and is never opened; no human
interaction is claimed (humanIntervention=false).

The persistent private `reports/publishing-safety/ledger.json` stores an append-only
hash-chained event history. Each write uses an exclusive lock, same-directory
atomic rename, file and directory fsync; directory/file modes are 0700/0600.
Existing corrupt ledgers and symlink paths fail closed. A dedicated OS temp output
is available for tests; protected repository paths remain forbidden even for a
repository located under /tmp. A leftover lock is never automatically stolen.

Transitions: PENDING → RUNNING → COMPLETED/FAILED, or PENDING → BLOCKED/FAILED.
COMPLETED means **dry-run completed**, never published. publishedUrl remains null
and all seven action permissions remain false, in every state. RUNNING records
survive crashes; they are not automatically retried or changed to completed.

Idempotency key: SHA-256 of experimentId/candidateId/channel/contentUnit/variant.
The material payload additionally binds LP, plan, content hash, UTM and affiliate
ID. Identical replays return the existing run; a different payload with the same
logical key records BLOCKED. Explicit retries of BLOCKED/FAILED only are capped
at three and retain history. No automatic retries, experiment starts or slot releases.

Tests use fabricated data and an injected dry-run check; no browser connection is
required or exercised. This does not establish a production publishing capability.
Future browser delivery and actual publication receipts require separately approved
design and tests. Rollback: stop invoking this CLI and revert its code; retain the
private ledger and review history. Do not delete evidence or enable another publisher.
