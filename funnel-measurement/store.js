import { mkdir, readFile, writeFile, rename, rm, lstat } from "node:fs/promises";
import { resolve, join, parse } from "node:path";
import { randomUUID } from "node:crypto";
import { assert, assertTimestamp, SCHEMA_VERSION } from "./model.js";

// A single atomic ledger contains immutable snapshots, never a running sum of CSVs.
// No stable transaction ID is present in the confirmed format: do NOT merge rows across imports.
export async function ensurePrivateDirectory(root) {
  const absolute = resolve(root);
  let cursor = parse(absolute).root;
  for (const part of absolute.slice(cursor.length).split(/[\\/]/).filter(Boolean)) {
    cursor = join(cursor, part);
    try { assert(!(await lstat(cursor)).isSymbolicLink(), "private出力先のsymlinkは許可しません"); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  await mkdir(absolute, { recursive: true, mode: 0o700 });
  return absolute;
}

export async function readLedger(root) {
  await ensurePrivateDirectory(root);
  let ledger;
  try { ledger = JSON.parse(await readFile(join(root, "ledger.json"), "utf8")); }
  catch (error) {
    if (error.code === "ENOENT") return { schemaVersion: SCHEMA_VERSION, imports: [] };
    throw new Error("ledgerの読取に失敗しました。既存データは上書きしません");
  }
  assert(ledger.schemaVersion === SCHEMA_VERSION && Array.isArray(ledger.imports), "未対応または破損したledgerです");
  return ledger;
}

export async function importSnapshot(root, snapshot) {
  await ensurePrivateDirectory(root);
  const lock = join(root, ".import-lock");
  try { await mkdir(lock, { mode: 0o700 }); }
  catch (error) {
    if (error.code === "EEXIST") throw new Error("別の取込が実行中です。中断時のlockは実行停止を確認してから回復してください");
    throw error;
  }
  const temp = join(root, `.ledger-${randomUUID()}.tmp`);
  try {
    const ledger = await readLedger(root);
    const sameScope = ledger.imports.filter((entry) => entry.batch.scopeKey === snapshot.batch.scopeKey);
    const duplicate = sameScope.find((entry) => entry.batch.coverage === snapshot.batch.coverage &&
      entry.batch.snapshotAsOf === snapshot.batch.snapshotAsOf &&
      (entry.batch.sourceFileHash === snapshot.batch.sourceFileHash || entry.batch.normalizedContentHash === snapshot.batch.normalizedContentHash));
    if (duplicate) return { status: "DUPLICATE", importId: duplicate.batch.importId, ledger };
    const collision = sameScope.find((entry) => entry.batch.snapshotAsOf === snapshot.batch.snapshotAsOf);
    assert(!collision, "同一scope・同一snapshotAsOfの内容/coverageが競合しています。無断置換しません");
    // Identical bytes at a later as-of are a new observation, not new earnings.
    // Keep them for freshness/history and select exactly one snapshot per report.
    ledger.imports.push(snapshot);
    await writeFile(temp, JSON.stringify(ledger, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    await rename(temp, join(root, "ledger.json"));
    return { status: "IMPORTED", importId: snapshot.batch.importId, ledger };
  } finally {
    await rm(temp, { force: true });
    await rm(lock, { recursive: true, force: true });
  }
}

export function selectSnapshot(ledger, { accountScopeId, reportLabel, isSynthetic = false, asOf = null }) {
  if (asOf !== null) assertTimestamp(asOf, "asOf");
  const matches = ledger.imports.filter(({ batch }) => batch.accountScopeId === accountScopeId && batch.reportLabel === reportLabel &&
    batch.isSynthetic === isSynthetic && (!asOf || Date.parse(batch.snapshotAsOf) <= Date.parse(asOf)));
  if (!matches.length) return null;
  const scopes = new Set(matches.map(({ batch }) => batch.scopeKey));
  assert(scopes.size === 1, "通貨・期間基準の異なるsnapshotはまとめられません");
  return [...matches].sort((a, b) => Date.parse(b.batch.snapshotAsOf) - Date.parse(a.batch.snapshotAsOf))[0];
}
