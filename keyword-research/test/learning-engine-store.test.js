import test from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir, symlink, lstat } from "node:fs/promises";
import { join } from "node:path";
import { emptyLedger, hash } from "../../learning-engine/model.js";
import { append, transact, readLedger, validateLedger, validateRoot } from "../../learning-engine/store.js";
import { buildImport } from "../../learning-engine/sources.js";
import { buildReview, activeRevisions } from "../../learning-engine/learning.js";
import { base, reviewed, readFixture, temporary, IMPORTED_AT, AS_OF } from "./learning-engine-helpers.js";

test("same import is idempotent and preserves first recordedAt", () => {
  const b = base(); const later = buildImport(b.manifest, b.loaded, { recordedAt: AS_OF, codeCommit: "synthetic-commit" });
  const repeated = append(b.ledger, later); assert.equal(repeated.status, "DUPLICATE");
  assert.equal(hash(repeated.ledger), hash(b.ledger)); assert.equal(Date.parse(repeated.ledger.evidence[0].recordedAt), Date.parse(IMPORTED_AT));
});
test("reformatted input creates provenance without duplicate observations", () => {
  const b = base(); const loaded = structuredClone(b.loaded); loaded[0].sourceFileHash = hash(JSON.stringify(loaded[0].data, null, 4));
  const newImport = buildImport(b.manifest, loaded, { recordedAt: AS_OF, codeCommit: "synthetic-commit" });
  const r = append(b.ledger, newImport); assert.equal(r.ledger.sourceImports.length, 2);
  assert.equal(r.ledger.evidence.length, b.ledger.evidence.length); assert.equal(r.ledger.experimentSnapshots.length, 1);
});
test("same manual review reimport is idempotent", async () => {
  const b = await reviewed(); const repeated = buildReview(b.ledger, b.review, { recordedAt: AS_OF });
  const r = append(b.ledger, repeated); assert.equal(r.status, "DUPLICATE"); assert.equal(hash(r.ledger), hash(b.ledger));
});
test("correction appends revision and preserves exact earlier records", async () => {
  const b = await reviewed(), before = hash(b.ledger), old = b.ledger.learnings[0];
  const r = structuredClone(b.review); r.reviewId = "correction"; r.decisions = [];
  Object.assign(r.learnings[0], { revisionId: "v2", supersedesRevisionId: "v1", reason: "Correct the interpretation" });
  r.learnings[0].claim.text = "Corrected hypothesis, no cause established";
  const ledger = append(b.ledger, buildReview(b.ledger, r, { recordedAt: AS_OF })).ledger;
  assert.equal(hash(b.ledger), before); assert.deepEqual(ledger.learnings[0], old); assert.equal(ledger.learnings.length, 2);
  assert.equal(activeRevisions(ledger.learnings, AS_OF)[0].active.revisionId, "v2");
  assert.equal(activeRevisions(ledger.learnings, IMPORTED_AT)[0].active.revisionId, "v1");
});
test("parallel corrections remain CONFLICT until all leaf revisions are explicitly resolved", async () => {
  const b = await reviewed(); let ledger = b.ledger;
  for (const id of ["v2", "v3"]) {
    const r = structuredClone(b.review); r.decisions = []; r.reviewId = id;
    Object.assign(r.learnings[0], { revisionId: id, supersedesRevisionId: "v1", reason: `Independent correction ${id}` });
    ledger = append(ledger, buildReview(ledger, r, { recordedAt: IMPORTED_AT })).ledger;
  }
  assert.equal(activeRevisions(ledger.learnings, AS_OF)[0].state, "CONFLICT");
  const resolve = structuredClone(b.review); resolve.reviewId = "resolve"; resolve.decisions = [];
  Object.assign(resolve.learnings[0], { revisionId: "v4", resolvesRevisionIds: ["v2"], reason: "Resolve disagreement" });
  assert.throws(() => buildReview(ledger, resolve, { recordedAt: AS_OF }));
  resolve.learnings[0].resolvesRevisionIds = ["v2", "v3"];
  ledger = append(ledger, buildReview(ledger, resolve, { recordedAt: AS_OF })).ledger;
  assert.equal(activeRevisions(ledger.learnings, AS_OF)[0].state, "ACTIVE"); assert.equal(ledger.learnings.length, 4);
});
test("same revision changed contents, dangling parent and self reference are rejected", async () => {
  const b = await reviewed();
  const changed = structuredClone(b.review); changed.learnings[0].reason = "Changed without a new revision";
  assert.throws(() => buildReview(b.ledger, changed, { recordedAt: AS_OF }));
  const r = structuredClone(b.review); r.decisions = []; r.learnings[0].revisionId = "v2"; r.learnings[0].supersedesRevisionId = "missing";
  assert.throws(() => buildReview(b.ledger, r, { recordedAt: AS_OF }));
  r.learnings[0].supersedesRevisionId = "v2"; assert.throws(() => buildReview(b.ledger, r, { recordedAt: AS_OF }));
});
test("retraction preserves claim, evidence and history", async () => {
  const b = await reviewed(), r = structuredClone(b.review); r.decisions = [];
  Object.assign(r.learnings[0], { revisionId: "withdrawn", supersedesRevisionId: "v1", reviewStatus: "RETRACTED", reason: "New counter evidence, retain old claim" });
  const ledger = append(b.ledger, buildReview(b.ledger, r, { recordedAt: AS_OF })).ledger;
  assert.equal(activeRevisions(ledger.learnings, AS_OF)[0].state, "RETRACTED"); assert.equal(ledger.learnings[0].reviewStatus, "ACCEPTED");
});
test("atomic transaction and lock failure leave existing ledger unchanged", async (t) => {
  const temp = await temporary(t), b = base();
  await transact(temp.root, "AFFILIATE_MONETIZATION", () => b.additions);
  const before = await readFile(join(temp.root, "ledger.json"), "utf8");
  await assert.rejects(transact(temp.root, "AFFILIATE_MONETIZATION", () => { throw new Error("bad review"); }));
  assert.equal(await readFile(join(temp.root, "ledger.json"), "utf8"), before);
  await mkdir(join(temp.root, ".import-lock")); await assert.rejects(transact(temp.root, "AFFILIATE_MONETIZATION", () => b.additions));
  assert.equal(await readFile(join(temp.root, "ledger.json"), "utf8"), before);
  assert.equal((await lstat(join(temp.root, "ledger.json"))).mode & 0o777, 0o600);
});
test("corrupt or unknown-version ledger is never replaced by empty data", async (t) => {
  const temp = await temporary(t), b = base();
  for (const contents of ["{corrupt", JSON.stringify({ schemaVersion: 2 }), JSON.stringify({ ...b.ledger, evidence: [] })]) {
    await writeFile(join(temp.root, "ledger.json"), contents);
    await assert.rejects(readLedger(temp.root)); await assert.rejects(transact(temp.root, "AFFILIATE_MONETIZATION", () => b.additions));
    assert.equal(await readFile(join(temp.root, "ledger.json"), "utf8"), contents);
  }
  const bad = structuredClone(b.ledger); bad.evidence[0].value = 999; assert.throws(() => validateLedger(bad));
});
test("symlink ledger and non-private roots are rejected", async (t) => {
  const temp = await temporary(t), target = await temp.write("target.json", base().ledger);
  await symlink(target, join(temp.root, "ledger.json")); await assert.rejects(readLedger(temp.root));
  assert.throws(() => validateRoot("/workspace/rakuten-affiliate/docs")); assert.throws(() => validateRoot("/tmp"));
});
