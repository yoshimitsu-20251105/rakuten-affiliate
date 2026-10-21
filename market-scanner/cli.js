#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { dirname, resolve, relative, isAbsolute, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { assert } from "./model.js";
import { scanManifest, writeRun } from "./report.js";

const REPO_ROOT = fileURLToPath(new URL("../", import.meta.url));
const DEFAULT_ROOT = join(REPO_ROOT, "reports/market-scanner");

async function main() {
  const args = {};
  const allowed = new Set(["manifest", "run-id", "as-of", "previous-run", "private-dir"]);
  for (let i = 2; i < process.argv.length; i += 2) {
    const name = process.argv[i].slice(2), value = process.argv[i + 1];
    assert(process.argv[i].startsWith("--") && allowed.has(name) && value && !value.startsWith("--") && !Object.hasOwn(args, name), "CLI引数が不正/重複です");
    args[name] = value;
  }
  assert(args.manifest, "--manifestが必要です");
  let root = DEFAULT_ROOT;
  if (args["private-dir"]) {
    root = resolve(args["private-dir"]);
    const rel = relative(resolve(tmpdir()), root);
    assert(rel && !rel.startsWith("..") && !isAbsolute(rel), "--private-dirはOS一時領域の専用サブディレクトリのみです");
  }
  const path = resolve(args.manifest);
  const manifest = JSON.parse(await readFile(path, "utf8"));
  let previous = null;
  if (args["previous-run"]) {
    assert(/^[a-zA-Z0-9_-]+$/.test(args["previous-run"]), "previous-runが不正です");
    previous = JSON.parse(await readFile(join(root, args["previous-run"], "candidates.json"), "utf8"));
  }
  const codeCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: REPO_ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  const report = await scanManifest(manifest, { baseDir: dirname(path), repoRoot: REPO_ROOT, runId: args["run-id"] ?? randomUUID(), asOf: args["as-of"] ?? new Date().toISOString(), previous, codeCommit });
  await writeRun(root, report);
  console.log(JSON.stringify({ status: report.status, runId: report.runId, candidateCount: report.candidates.length, outputType: report.outputType }));
}

main().catch((e) => {
  if (e.code || e instanceof SyntaxError || e instanceof TypeError) console.error("[market] 入出力/JSON/型エラー。入力と参照先を確認してください");
  else console.error(`[market] ${e.message}`);
  process.exitCode = 1;
});
