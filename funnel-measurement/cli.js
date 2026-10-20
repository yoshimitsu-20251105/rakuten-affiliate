#!/usr/bin/env node
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join, resolve, relative, isAbsolute } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { parseRakutenOrder } from "./rakuten-order.js";
import { importSnapshot, readLedger, selectSnapshot, ensurePrivateDirectory } from "./store.js";
import { buildFunnelReport, renderFunnelMarkdown } from "./report.js";
import { validateMeasurementRecord, assertNewAffiliateNoteExperimentAllowed } from "./measurement-status.js";
import { assert, assertTimestamp, hash } from "./model.js";

const DEFAULT_PRIVATE_ROOT = fileURLToPath(new URL("../reports/funnel-measurement/", import.meta.url));
const KNOWN = new Set(["csv", "metadata", "account", "month", "as-of", "synthetic", "analytics-report", "analytics-metadata", "lp", "measurement-record", "html", "mapping", "run-id", "experiment-id", "property", "at", "private-dir"]);
function parseArgs(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i++) {
    assert(argv[i].startsWith("--") && KNOWN.has(argv[i].slice(2)), "未対応のCLI引数です");
    const key = argv[i].slice(2);
    assert(!(key in result), `引数重複: ${key}`);
    if (key === "synthetic") result[key] = true;
    else { assert(argv[i + 1] && !argv[i + 1].startsWith("--"), `引数値が必要です: ${key}`); result[key] = argv[++i]; }
  }
  return result;
}
const json = async (path) => JSON.parse(await readFile(path, "utf8"));
const required = (args, key) => { assert(args[key], `--${key}が必要です`); return args[key]; };

async function privateRoot(args) {
  if (!args["private-dir"]) return ensurePrivateDirectory(DEFAULT_PRIVATE_ROOT);
  // For isolated CLI tests or temporary private runs only. Never permit docs/ outputs.
  const root = resolve(args["private-dir"]);
  const rel = relative(resolve(tmpdir()), root);
  assert(rel && !rel.startsWith("..") && !isAbsolute(rel), "--private-dirは一時領域の専用サブディレクトリのみ対応します");
  return ensurePrivateDirectory(root);
}

async function main() {
  const [command, ...argv] = process.argv.slice(2);
  const args = parseArgs(argv);
  if (command === "import-order") {
    const snapshot = parseRakutenOrder(await readFile(required(args, "csv")), await json(required(args, "metadata")));
    const result = await importSnapshot(await privateRoot(args), snapshot);
    console.log(JSON.stringify({ status: result.status, importId: result.importId, resultType: snapshot.batch.resultType, records: snapshot.batch.recordCount, periodStatus: snapshot.batch.periodStatus }));
  } else if (command === "report") {
    required(args, "account"); required(args, "month");
    assert(/^\d{4}\.(0[1-9]|1[0-2])$/.test(args.month), "--monthはYYYY.MMです");
    if (args["as-of"]) assertTimestamp(args["as-of"], "as-of");
    const root = await privateRoot(args);
    const snapshot = selectSnapshot(await readLedger(root), { accountScopeId: args.account, reportLabel: args.month, isSynthetic: args.synthetic === true, asOf: args["as-of"] ?? null });
    const analyticsReport = args["analytics-report"] ? await json(args["analytics-report"]) : null;
    if (analyticsReport) { required(args, "analytics-metadata"); required(args, "lp"); }
    const report = buildFunnelReport({ snapshot, analyticsReport,
      analyticsMetadata: analyticsReport ? await json(args["analytics-metadata"]) : null,
      targetLP: args.lp ?? null,
      measurementRecord: args["measurement-record"] ? await json(args["measurement-record"]) : null,
      currentPageHash: args.html ? hash(await readFile(args.html)) : null,
      mapping: args.mapping ? await json(args.mapping) : null,
    });
    report.requestedScope = { accountScopeId: args.account, reportLabel: args.month, asOf: args["as-of"] ?? null, isSynthetic: args.synthetic === true };
    const runId = args["run-id"] ?? randomUUID();
    assert(/^[a-zA-Z0-9_-]+$/.test(runId), "run-idが不正です");
    const output = await ensurePrivateDirectory(join(root, "report-runs"));
    const staging = join(output, `.pending-${randomUUID()}`);
    await mkdir(staging, { mode: 0o700 });
    const { rename, rm } = await import("node:fs/promises");
    try {
      await writeFile(join(staging, "report.json"), JSON.stringify(report, null, 2) + "\n", { flag: "wx", mode: 0o600 });
      await writeFile(join(staging, "report.md"), renderFunnelMarkdown(report), { flag: "wx", mode: 0o600 });
      // mkdir is an exclusive reservation; concurrent/same run IDs cannot overwrite results.
      const destination = join(output, runId);
      await mkdir(destination, { mode: 0o700 });
      try { await rename(staging, destination); }
      catch (error) { await rm(destination, { recursive: true, force: true }); throw error; }
      console.log(JSON.stringify({ status: "REPORTED", runId, importId: snapshot?.batch.importId ?? null }));
    } finally { await rm(staging, { recursive: true, force: true }); }
  } else if (command === "validate-measurement") {
    const record = validateMeasurementRecord(await json(required(args, "measurement-record")));
    const root = await ensurePrivateDirectory(join(await privateRoot(args), "measurement-records"));
    const recordId = hash(JSON.stringify(record));
    try { await writeFile(join(root, `${recordId}.json`), JSON.stringify(record, null, 2) + "\n", { flag: "wx", mode: 0o600 }); }
    catch (error) { if (error.code !== "EEXIST") throw error; }
    console.log(JSON.stringify({ status: "SAVED", recordId, affiliateClickMeasurementStatus: record.affiliateClickMeasurementStatus }));
  } else if (command === "check-note-start") {
    const record = await json(required(args, "measurement-record"));
    const result = assertNewAffiliateNoteExperimentAllowed({
      purpose: "AFFILIATE_NOTE_ACQUISITION", experimentId: required(args, "experiment-id"),
      targetLP: required(args, "lp"), currentPageHash: hash(await readFile(required(args, "html"))),
      ga4PropertyReference: required(args, "property"), measurementRecord: record,
      at: args.at ?? new Date().toISOString(),
    });
    console.log(JSON.stringify(result));
  } else throw new Error("commandはimport-order / report / validate-measurement / check-note-startです");
}

main().catch((error) => {
  // Do not echo source records, credentials, or absolute filesystem paths.
  if (error.code || error instanceof SyntaxError) console.error("[funnel] 入出力/JSONエラー。入力形式と参照先を確認してください");
  else console.error(`[funnel] ${error.message}`);
  process.exitCode = 1;
});
