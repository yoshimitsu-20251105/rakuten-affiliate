import { readFile, writeFile, rename, mkdir, rm, lstat } from "node:fs/promises";
import { join, resolve, relative, isAbsolute } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { ensurePrivateDirectory } from "../funnel-measurement/store.js";
import { assert, object, text, keys, hash, seal, recordPayload, timestamp, emptyLedger, PURPOSES, COLLECTIONS,
  EVIDENCE_TYPES, ACTIONS, scope, strings, validateCondition, purposeCompatible } from "./model.js";
import { validateRevisionGraph } from "./learning.js";

export const DEFAULT_ROOT = fileURLToPath(new URL("../reports/learning-engine/", import.meta.url));
export function validateRoot(root) {
  const absolute = resolve(root), rel = relative(resolve(tmpdir()), absolute);
  assert(absolute === resolve(DEFAULT_ROOT) || rel && !rel.startsWith("..") && !isAbsolute(rel), "Output must use private Learning root or dedicated OS temp directory");
  return absolute;
}
export function validateLedger(ledger) {
  keys(ledger, ["schemaVersion", "purpose", ...COLLECTIONS]);
  assert(ledger.schemaVersion === 1 && PURPOSES.includes(ledger.purpose), "Unsupported or corrupt Learning ledger");
  const all = new Map();
  for (const collection of COLLECTIONS) {
    assert(Array.isArray(ledger[collection]), "Invalid ledger collection");
    for (const record of ledger[collection]) {
      assert(object(record) && typeof record.isSynthetic === "boolean", "Invalid record"); timestamp(record.recordedAt);
      assert(seal(collection, recordPayload(record), record.recordedAt).recordId === record.recordId && !all.has(record.recordId), "Record integrity/identity mismatch");
      all.set(record.recordId, record);
      if (collection === "sourceImports") {
        assert(text(record.sourceId) && text(record.sourceType) && /^[a-f0-9]{64}$/.test(record.sourceFileHash), "Invalid source provenance");
        strings(record.recordRefs); assert(Array.isArray(record.links), "Invalid source links");
      } else {
        scope(record.scope); assert(Array.isArray(record.sourceRefs) && record.sourceRefs.length > 0, "Source provenance required");
      }
      if (collection === "evidence") {
        assert(text(record.metricOrClaim) && Object.hasOwn(record, "value") && EVIDENCE_TYPES.includes(record.evidenceType) && text(record.availability), "Invalid evidence");
      }
      if (collection === "experimentSnapshots") assert(text(record.experimentId) && object(record.raw), "Invalid experiment snapshot");
      if (collection === "decisions") assert(record.decision === null || ACTIONS.includes(record.decision), "Invalid decision action");
      if (collection === "learnings") {
        assert(EVIDENCE_TYPES.includes(record.claim?.evidenceType) && ["PROPOSED", "ACCEPTED", "RETRACTED"].includes(record.reviewStatus), "Invalid learning");
        assert(Array.isArray(record.retryConditions), "Missing retry conditions"); record.retryConditions.forEach(validateCondition);
      }
    }
  }
  const evidence = new Map(ledger.evidence.map((e) => [e.recordId, e]));
  for (const source of ledger.sourceImports) for (const link of source.links) {
    assert(ledger.experimentSnapshots.some((e) => e.experimentId === link.experimentId && e.isSynthetic === source.isSynthetic), "Dangling source experiment link");
    for (const id of link.evidenceRefs ?? []) assert(evidence.has(id) && evidence.get(id).isSynthetic === source.isSynthetic, "Dangling source mapping evidence");
  }
  for (const source of ledger.sourceImports) for (const id of source.recordRefs) {
    assert(all.has(id) && !id.startsWith("sourceImports:"), "Dangling import reference");
    assert(source.isSynthetic || !all.get(id).isSynthetic, "Synthetic source provenance mismatch");
  }
  for (const collection of COLLECTIONS.filter((k) => k !== "sourceImports")) for (const record of ledger[collection]) {
    assert(record.sourceRefs.every((ref) => ledger.sourceImports.some((s) => s.sourceId === ref.sourceId && s.sourceType === ref.sourceType && s.recordRefs.includes(record.recordId))), "Missing raw-source provenance");
    const refs = [...(record.evidenceRefs ?? []), ...(record.counterEvidenceRefs ?? []), ...(record.scopeEvidenceRefs ?? []),
      ...(record.falsification?.evidenceRefs ?? []), ...(record.falsification?.counterEvidenceRefs ?? []),
      ...(record.retryConditions ?? []).flatMap((c) => c.evidenceRefs)];
    for (const id of refs) assert(evidence.has(id) && evidence.get(id).isSynthetic === record.isSynthetic, "Dangling or mixed synthetic evidence");
  }
  for (const c of ["decisions", "learnings"]) validateRevisionGraph(ledger[c]);
  return ledger;
}
export function append(ledger, additions) {
  validateLedger(ledger); assert(purposeCompatible(ledger.purpose, additions.purpose), "Ledger purpose mismatch");
  const out = structuredClone(ledger); let added = 0;
  for (const c of COLLECTIONS) {
    const ids = new Map(out[c].map((r) => [r.recordId, r]));
    for (const r of additions[c]) {
      const prior = ids.get(r.recordId);
      if (prior) assert(hash(recordPayload(prior)) === hash(recordPayload(r)), "Duplicate identity with changed contents");
      else { out[c].push(structuredClone(r)); ids.set(r.recordId, r); added++; }
    }
  }
  validateLedger(out); return { ledger: out, status: added ? "APPENDED" : "DUPLICATE", added };
}
export async function rejectSymlink(path) {
  try { assert(!(await lstat(path)).isSymbolicLink(), "Symlink file is not allowed"); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
}
export async function readLedger(root, { purpose = "AFFILIATE_MONETIZATION", allowMissing = false } = {}) {
  root = validateRoot(root); await ensurePrivateDirectory(root); const path = join(root, "ledger.json");
  await rejectSymlink(path);
  let bytes;
  try { bytes = await readFile(path); }
  catch (error) { if (error.code === "ENOENT" && allowMissing) return emptyLedger(purpose); throw new Error("Learning ledger not readable; existing data not replaced"); }
  let ledger;
  try { ledger = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { throw new Error("Learning ledger corrupt; existing data not replaced"); }
  return validateLedger(ledger);
}
// The callback validates/builds the entire append under the same lock. No earlier
// entries are edited; only a fully validated new ledger replaces the old bytes.
export async function transact(root, purpose, build) {
  root = validateRoot(root); await ensurePrivateDirectory(root);
  const lock = join(root, ".import-lock"), temp = join(root, `.ledger-${randomUUID()}.tmp`);
  try { await mkdir(lock, { mode: 0o700 }); } catch { throw new Error("Learning import lock unavailable; stop other writers before recovery"); }
  try {
    const ledger = await readLedger(root, { purpose, allowMissing: true });
    const result = append(ledger, await build(structuredClone(ledger)));
    if (result.status !== "DUPLICATE") {
      await writeFile(temp, JSON.stringify(result.ledger, null, 2) + "\n", { mode: 0o600, flag: "wx" });
      await rejectSymlink(join(root, "ledger.json")); await rename(temp, join(root, "ledger.json"));
    }
    return result;
  } finally { await rm(temp, { force: true }); await rm(lock, { recursive: true, force: true }); }
}
