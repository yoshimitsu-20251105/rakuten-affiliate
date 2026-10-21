import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir, stat, symlink } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync, execFileSync } from "node:child_process";
import { buildReport, compareRuns, readInputs, writeRun, renderMarkdown, validateOutputRoot } from "../../opportunity-scorer/report.js";
import { hash } from "../../opportunity-scorer/model.js";
import { data, run, temporary, AS_OF, hasKey } from "./opportunity-scorer-helpers.js";

const REPO=fileURLToPath(new URL("../../",import.meta.url));
const CLI=join(REPO,"opportunity-scorer/cli.js");

test("same inputs/policy/asOf reproduce assessments and parsed/generated times alone do not update them", async () => {
  const d=await data(),first=run(d);
  const second=run(d,{runId:"second",generatedAt:"2026-10-22T00:00:00Z",previous:first});
  assert(second.diff.changes.every(c=>c.state==="UNCHANGED"));
  assert.equal(second.diff.policyChanged,false);assert.equal(second.diff.asOfChanged,false);
  assert.deepEqual(second.assessments,first.assessments);
});

test("diff detects changed points, policy/asOf and missing candidates without a KILL decision", async () => {
  const d=await data(),first=run(d);d.context.assessments[0].components.purchaseIntent.value=35;
  assert(run(d,{previous:first}).diff.changes.some(c=>c.state==="UPDATED"));
  const noCandidates={...first,assessments:[],observedPerformance:[]};
  assert(compareRuns(noCandidates,first).changes.every(c=>c.state==="NOT_OBSERVED_THIS_RUN"));
  const newPolicy={...first,policyHash:"changed",asOf:"2026-10-22T00:00:00Z"};
  const diff=compareRuns(newPolicy,first);assert(diff.policyChanged);assert(diff.asOfChanged);
});

test("no candidates and omitted context are valid gaps, not fixture fallback", async () => {
  const d=await data();d.scanner.candidates=[];d.context=null;
  assert.equal(run(d).status,"NO_CANDIDATES");
  const e=await data();e.context=null;
  assert.equal(run(e).status,"COMPLETED_WITH_GAPS");
});

test("output objects cannot mutate the original input context or Scanner periods", async () => {
  const d=await data({nonSyntheticSchemaBranch:true}),before=structuredClone(d),r=run(d);
  r.assessments[0].components.demand.period.applicablePeriod.start="2000-01-01";
  r.assessments[0].itemCodes.push("wrong");r.observedPerformance[0].metrics.revenue.period.start="2000-01-01";
  assert.deepEqual(d,before);
});

test("private output has all three files, permissions and exclusive run IDs; no public output is allowed", async(t)=>{
  const {root}=await temporary(t),report=run(await data()),out=join(root,"private");
  await writeRun(out,report);
  assert.deepEqual((await readdir(join(out,report.runId))).sort(),["assessments.json","report.md","run-metadata.json"]);
  const before=await readFile(join(out,report.runId,"assessments.json"));
  await assert.rejects(writeRun(out,report),/EEXIST/);
  assert.deepEqual(await readFile(join(out,report.runId,"assessments.json")),before);
  assert.equal((await readdir(out)).filter(p=>p.startsWith(".pending-")).length,0);
  if(process.platform!=="win32"){
    assert.equal((await stat(join(out,report.runId))).mode&0o777,0o700);
    assert.equal((await stat(join(out,report.runId,"assessments.json"))).mode&0o777,0o600);
  }
  assert.throws(()=>validateOutputRoot(join(REPO,"docs")));
  const alias=join(root,"alias");await symlink(out,alias);await assert.rejects(writeRun(alias,{...report,runId:"symlink-attempt"}));
  const md=renderMarkdown(report);assert.match(md,/FACT only/);assert.match(md,/not Revenue prediction/);assert.match(md,/UNKNOWN/);
  assert(!hasKey(report,"finalRank"));
});

test("CLI stays offline, preserves inputs/protected files and handles previous-run with no side effects", async(t)=>{
  const {root,write}=await temporary(t),d=await data();
  const scannerPath=await write("scanner.json",d.scanner),contextPath=await write("context.json",d.context);
  const inputHashes=[hash(await readFile(scannerPath)),hash(await readFile(contextPath))];
  const guard=await write("network-guard.mjs",'import http from "node:http";import https from "node:https";const fail=()=>{throw Error("UNEXPECTED_NETWORK")};globalThis.fetch=fail;http.get=fail;http.request=fail;https.get=fail;https.request=fail;\n');
  const privateDir=join(root,"runs");
  const execute=(...args)=>spawnSync(process.execPath,["--import",guard,CLI,"--scanner-report",scannerPath,"--context",contextPath,"--as-of",AS_OF,"--private-dir",privateDir,...args],{encoding:"utf8",env:{PATH:process.env.PATH,RAKUTEN_APP_ID:"synthetic-do-not-use",GA_SEARCH_CONSOLE_KEY_FILE:"synthetic-do-not-use"}});
  let result=execute("--run-id","first");assert.equal(result.status,0,result.stderr);
  result=execute("--run-id","second","--previous-run","first");assert.equal(result.status,0,result.stderr);
  const second=JSON.parse(await readFile(join(privateDir,"second/assessments.json"),"utf8"));
  assert(second.diff.changes.every(c=>c.state==="UNCHANGED"));
  assert.notEqual(execute("--run-id","first").status,0);
  assert.deepEqual([hash(await readFile(scannerPath)),hash(await readFile(contextPath))],inputHashes);
  execFileSync("git",["diff","--exit-code","HEAD","--","docs","strategy","funnel-measurement","market-scanner",".github/workflows","articles-data.json","selected-products.json","posted-history.json","sitemap-lastmod.json","select-products.js","generate-site.js","package-lock.json"],{cwd:REPO});
});

test("malformed JSON, missing files, bad hashes and invalid CLI leave no successful report or private names in logs", async(t)=>{
  const {root,write}=await temporary(t),d=await data();
  const path=await write("scanner-secret-name.json",d.scanner),out=join(root,"runs");
  const execute=(...args)=>spawnSync(process.execPath,[CLI,"--scanner-report",path,"--private-dir",out,"--run-id","bad","--as-of",AS_OF,...args],{encoding:"utf8"});
  for(const args of [["--publish","true"],["--previous-run","../escape"],["--context",join(root,"missing-secret-name.json")]]){
    const r=execute(...args);assert.notEqual(r.status,0);assert(!r.stderr.includes("missing-secret-name.json"));
  }
  await write("scanner-secret-name.json","{bad JSON");assert.notEqual(execute().status,0);
  await assert.rejects(readFile(join(out,"bad/assessments.json")),/ENOENT/);
  await assert.rejects(readInputs(path));
  assert.throws(()=>buildReport(d.scanner,{asOf:"2025-01-01T00:00:00Z"}),/after asOf/);
});
