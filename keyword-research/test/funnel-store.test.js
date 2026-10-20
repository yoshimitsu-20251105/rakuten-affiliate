import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, mkdir, writeFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseRakutenOrder as parseOrder } from "../../funnel-measurement/rakuten-order.js";
import { importSnapshot, readLedger, selectSnapshot } from "../../funnel-measurement/store.js";
import { aggregateRevenue } from "../../funnel-measurement/metrics.js";
import { zeroBytes, meta, recordsBytes } from "./funnel-helpers.js";

async function temp(t) { const dir = await mkdtemp(join(tmpdir(), "funnel-store-")); t.after(() => rm(dir, { recursive: true, force: true })); return dir; }

test("same CSV re-import and normalized equivalent are idempotent", async (t) => {
  const root = await temp(t);
  const snapshot = parseRakutenOrder(zeroBytes, meta());
  assert.equal((await importSnapshot(root, snapshot)).status, "IMPORTED");
  assert.equal((await importSnapshot(root, snapshot)).status, "DUPLICATE");
  const crlf = parseRakutenOrder(Buffer.from(zeroBytes.toString().replace(/\n/g, "\r\n")), meta());
  assert.equal((await importSnapshot(root, crlf)).status, "DUPLICATE");
  const equivalentTime = parseRakutenOrder(zeroBytes, meta({ snapshotAsOf: new Date(meta().snapshotAsOf).toISOString(), retrievedAt: new Date(meta().retrievedAt).toISOString() }));
  assert.equal((await importSnapshot(root, equivalentTime)).status, "DUPLICATE");
  assert.equal((await readLedger(root)).imports.length, 1);
});

test("later snapshot replaces view, not sum; cancellation is not a second subtraction", async (t) => {
  const root = await temp(t);
  const pending = parseRakutenOrder(recordsBytes([{ status: "0", rewards: "500" }]), meta());
  const approvedMeta = meta({ snapshotAsOf: "2026-10-21T12:00:00+09:00", retrievedAt: "2026-10-21T12:01:00+09:00" });
  const approved = parseRakutenOrder(recordsBytes([{ status: "1", rewards: "500" }]), approvedMeta);
  await importSnapshot(root, approved);
  await importSnapshot(root, pending); // late import must not replace newer source observation
  let ledger = await readLedger(root);
  const scope = { accountScopeId: "synthetic-account", reportLabel: "2026.10", isSynthetic: true };
  assert.equal(aggregateRevenue(selectSnapshot(ledger, scope)).revenue.value, 500);
  assert.equal(aggregateRevenue(selectSnapshot(ledger, scope)).approvedRevenue.value, 500);
  const cancelled = parseRakutenOrder(recordsBytes([{ status: "2", rewards: "500" }]), meta({ snapshotAsOf: "2026-10-22T12:00:00+09:00", retrievedAt: "2026-10-22T12:01:00+09:00" }));
  await importSnapshot(root, cancelled);
  ledger = await readLedger(root);
  const metrics = aggregateRevenue(selectSnapshot(ledger, scope));
  assert.equal(metrics.revenue.value, 0);
  assert.equal(metrics.cancelledRevenue.value, 500);
  assert.equal(aggregateRevenue(selectSnapshot(ledger, { ...scope, asOf: meta().snapshotAsOf })).revenue.value, 500);
});

test("same zero bytes at a later as-of update freshness without accumulating earnings", async (t) => {
  const root = await temp(t);
  await importSnapshot(root, parseRakutenOrder(zeroBytes, meta()));
  const next = meta({ snapshotAsOf: "2026-10-21T12:00:00+09:00", retrievedAt: "2026-10-21T12:01:00+09:00" });
  await importSnapshot(root, parseRakutenOrder(zeroBytes, next));
  const ledger = await readLedger(root);
  assert.equal(ledger.imports.length, 2);
  assert.equal(aggregateRevenue(selectSnapshot(ledger, { accountScopeId: next.accountScopeId, reportLabel: next.reportLabel, isSynthetic: true })).revenue.value, 0);
});

test("conflicting snapshots are rejected before persistence; synthetic cannot leak into live", async (t) => {
  const root = await temp(t);
  await importSnapshot(root, parseRakutenOrder(zeroBytes, meta()));
  const before = await readFile(join(root, "ledger.json"), "utf8");
  await assert.rejects(importSnapshot(root, parseRakutenOrder(recordsBytes([{}]), meta())), /競合/);
  assert.equal(await readFile(join(root, "ledger.json"), "utf8"), before);
  const sameInstant = meta({ snapshotAsOf: new Date(meta().snapshotAsOf).toISOString() });
  await assert.rejects(importSnapshot(root, parseRakutenOrder(recordsBytes([{}]), sameInstant)), /競合/);
  assert.equal(selectSnapshot(await readLedger(root), { accountScopeId: "synthetic-account", reportLabel: "2026.10" }), null);
});

test("lock/corrupt ledger and symlink paths fail closed", async (t) => {
  const root = await temp(t);
  await mkdir(join(root, ".import-lock"));
  await assert.rejects(importSnapshot(root, parseRakutenOrder(zeroBytes, meta())), /実行中/);
  await rm(join(root, ".import-lock"), { recursive: true });
  await writeFile(join(root, "ledger.json"), "bad JSON");
  await assert.rejects(importSnapshot(root, parseRakutenOrder(zeroBytes, meta())), /上書きしません/);
  assert.equal(await readFile(join(root, "ledger.json"), "utf8"), "bad JSON");
  await symlink(root, join(root, "link"));
  await assert.rejects(readLedger(join(root, "link")), /symlink/);
});

function parseRakutenOrder(bytes, metadata) { return parseOrder(bytes, metadata, { importedAt: "2026-12-01T00:00:00Z" }); }
