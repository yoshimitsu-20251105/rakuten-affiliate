import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, lstatSync, readlinkSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { contentHash } from "../../lib/sitemap-lastmod.js";
import { hash as recordHash } from '../../learning-engine/model.js';

// Explicitly approved test maintenance, not an exemption for product code.
const approvedTestEdits = new Set([
  "keyword-research/test/acquisition-planner-report.test.js",
  "keyword-research/test/experiment-selector-report.test.js",
  "keyword-research/test/learning-engine-report.test.js",
  "keyword-research/test/experiment-selector-gates.test.js",
  "keyword-research/test/learning-engine-sources.test.js",
]);
const git = (repo, args) => execFileSync("git", args, { cwd: repo, encoding: "utf8" });
const stamp = /(情報取得日|最終更新日): ?\d{4}年\d{1,2}月\d{1,2}日/g;
const urgency = /<p class="urgency">[^<]*<\/p>/g;

// Operational state changes require an explicit, separately reviewable closure
// record. This does not exempt strategy records or permit runtime CLI mutation.
export function permittedExperimentClosure(before, after, closure) {
  try {
    const old=JSON.parse(before),current=JSON.parse(after);
    if(closure?.schemaVersion!==1 || closure.kind!=='EXPERIMENT_CLOSURE' || closure.authorizedBy!=='user' || !closure.authorizationReference) return false;
    const id=closure.experimentId,a=old.items.find(e=>e.experimentId===id),b=current.items.find(e=>e.experimentId===id);
    if(!a || !b || a.status!=='RUNNING' || !['INCONCLUSIVE','STOPPED'].includes(b.status) || b.result!=='INCONCLUSIVE' || b.decision!=='HOLD') return false;
    if(closure.priorRecordHash!==recordHash(a) || closure.finalRecordHash!==recordHash(b)) return false;
    if(recordHash({...old,items:old.items.map(e=>e.experimentId===id?null:e)})!==recordHash({...current,items:current.items.map(e=>e.experimentId===id?null:e)})) return false;
    const fixed=({status,result,decision,metrics,learnings,...rest})=>rest;
    if(recordHash(fixed(a))!==recordHash(fixed(b))) return false;
    if(recordHash(b.metrics)!==recordHash([...(a.metrics??[]),...closure.appendedMetrics]) || recordHash(b.learnings)!==recordHash([...(a.learnings??[]),...closure.appendedLearnings])) return false;
    const evidence=closure.evidence,threshold=a.successThreshold.channelSessionsMin;
    if(closure.period.start!==a.startDate || closure.period.end!==a.reviewDate) return false;
    if(b.status==='STOPPED') {
      if(closure.reasonType!=='MEASUREMENT_UNAVAILABLE_OPERATIONAL_HOLD' || evidence.currentObservation?.status!=='MISSING' || evidence.currentObservation.apiCalls!==0 || !evidence.currentObservation.reason || evidence.reviewDate!==a.reviewDate) return false;
    } else {
      if(recordHash(evidence.period)!==recordHash(closure.period)) return false;
      if(![evidence.ga4.note.sessions,evidence.ga4.x.sessions].every(n=>Number.isFinite(n)&&n>=0&&n<threshold)) return false;
      if(evidence.trafficSufficiency.value!=='FAILED' || evidence.trafficSufficiency.thresholdPerChannel!==threshold || evidence.ga4.postPeriodIncluded!==false) return false;
      if(evidence.ga4.affiliateClick.status!=='NO_ROWS_RETURNED' || evidence.ga4.affiliateClick.value!==null) return false;
    }
    if(closure.actions.closeExistingExperiment!==true || closure.actions.startNewExperiment!==false || closure.actions.publish!==false || closure.actions.post!==false || closure.actions.AUTO_PUBLISH!==false) return false;
    return true;
  } catch {return false;}
}
export function permittedOperationalClosures(before,after,closures) {
  try {
    const old=JSON.parse(before),current=JSON.parse(after);let expected=structuredClone(old);
    for(const row of old.items) {
      const next=current.items.find(e=>e.experimentId===row.experimentId);if(!next)return false;
      if(recordHash(row)===recordHash(next))continue;
      const matching=closures.filter(c=>c.experimentId===row.experimentId && c.priorRecordHash===recordHash(row) && c.finalRecordHash===recordHash(next));
      if(matching.length!==1)return false;
      const updated={...expected,items:expected.items.map(e=>e.experimentId===row.experimentId?next:e)};
      if(!permittedExperimentClosure(JSON.stringify(expected),JSON.stringify(updated),matching[0]))return false;
      expected=updated;
    }
    return recordHash(expected)===recordHash(current);
  } catch{return false;}
}

export function permittedGeneratedUpdate(path, before, after, readCurrent) {
  if (/^docs\/articles\/[^/]+\.html$/.test(path)) {
    // Existing urgency text may expire; adding/replacing claims, CTA, links or
    // other article content is not made legitimate by its generated location.
    const oldClaims = before.match(urgency) ?? [], newClaims = after.match(urgency) ?? [];
    return newClaims.every((claim) => newClaims.filter(x=>x===claim).length <= oldClaims.filter(x=>x===claim).length) &&
      before.replace(stamp, "$1:").replace(urgency, "") === after.replace(stamp, "$1:").replace(urgency, "");
  }
  if (path === "docs/sitemap.xml") {
    const strip = (s) => s.replace(/<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/g, "");
    return strip(before) === strip(after);
  }
  if (path === "sitemap-lastmod.json") {
    const old = JSON.parse(before), current = JSON.parse(after);
    if (JSON.stringify(Object.keys(old).sort()) !== JSON.stringify(Object.keys(current).sort())) return false;
    return Object.entries(current).every(([page, entry]) => {
      if (JSON.stringify(entry) === JSON.stringify(old[page])) return true;
      return Object.keys(entry).sort().join(",") === "hash,lastmod" &&
        /^\d{4}-\d{2}-\d{2}$/.test(entry.lastmod ?? "") &&
        entry.hash === contentHash(readCurrent(`docs/${page}`));
    });
  }
  return false;
}

export function captureProtectedTree(repo) {
  const files = [...new Set(git(repo, ["ls-files", "--cached", "--others", "--exclude-standard", "-z"]).split("\0").filter(Boolean))].sort();
  return Object.fromEntries(files.map((path) => {
    const file = join(repo, path);
    try {
      const stat = lstatSync(file), value = stat.isSymbolicLink() ? `SYMLINK:${readlinkSync(file)}` : readFileSync(file);
      return [path, createHash("sha256").update(value).digest("hex")];
    } catch (error) { if (error.code === "ENOENT") return [path, "MISSING"]; throw error; }
  }));
}
export function assertProtectedTreeUnchanged(before, after) { assert.deepEqual(after, before, "CLI changed a protected file or file identity"); }

export function assertHistoricalProtection(repo, { base, modules = {} }) {
  const historical = new Set(git(repo, ["ls-tree", "-r", "--name-only", base]).trim().split("\n"));
  const changed = git(repo, ["diff", "--name-only", base, "--", ...historical]).trim().split("\n").filter(Boolean);
  for (const path of changed) {
    if (approvedTestEdits.has(path) || path === "package.json") continue;
    const before = git(repo, ["show", `${base}:${path}`]);
    let after; try { after = readFileSync(join(repo, path), "utf8"); } catch { assert.fail(`Protected asset deleted: ${path}`); }
    if(path==='strategy/experiments.json') {
      const directory=join(repo,'strategy/experiment-closures'),closures=readdirSync(directory).filter(f=>f.endsWith('.json')).map(f=>JSON.parse(readFileSync(join(directory,f),'utf8')));
      assert(permittedOperationalClosures(before,after,closures),'Unapproved experiment/closure change');continue;
    }
    assert(permittedGeneratedUpdate(path, before, after, (p) => readFileSync(join(repo, p), "utf8")), `Unapproved protected change: ${path}`);
  }
  for (const [directory, approvedRef] of Object.entries(modules)) {
    const expected = git(repo, ["ls-tree", "-r", "--name-only", approvedRef, "--", directory]).trim().split("\n").filter(Boolean).sort();
    const current = Object.keys(captureProtectedTree(repo)).filter((p) => p.startsWith(`${directory}/`)).sort();
    assert.deepEqual(current, expected, `Protected module file identities changed: ${directory}`);
    assert.equal(git(repo, ["diff", "--name-only", approvedRef, "--", directory]), "", `Protected module changed: ${directory}`);
  }
  const expectedArticles = [...historical].filter((p) => /^docs\/articles\/[^/]+\.html$/.test(p)).sort();
  const actualArticles = Object.keys(captureProtectedTree(repo)).filter((p) => /^docs\/articles\/[^/]+\.html$/.test(p)).sort();
  assert.deepEqual(actualArticles, expectedArticles, "Existing article identities changed");
}
