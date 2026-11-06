import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname,join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { writeInputs } from './acquisition-planner-helpers.js';
import { readInputs } from '../../acquisition-planner/sources.js';
import { buildReport } from '../../acquisition-planner/report.js';
import { loadContext } from '../../publishing-safety/sources.js';
import { hash } from '../../publishing-safety/model.js';
import { fixture,temporary,AS_OF } from './publishing-safety-helpers.js';
import { captureProtectedTree,assertProtectedTreeUnchanged } from './protected-assets-helpers.js';
const repo=fileURLToPath(new URL('../../',import.meta.url));
test('CLI revalidates actual Planner source boundary offline and leaves repository/input bytes unchanged',async(t)=>{
  const temp=await temporary(t),{request,bundle}=await fixture(),manifest=await writeInputs(temp,bundle);
  const input=await readInputs(manifest,AS_OF),report=buildReport(input,{runId:'synthetic-safety-source',generatedAt:AS_OF,codeCommit:'SYNTHETIC'});
  const reportPath=await temp.write('planner-report.json',report);
  request.plannerManifest={path:manifest,sha256:hash(await readFile(manifest))};request.plannerReport={path:reportPath,sha256:hash(await readFile(reportPath))};
  const context=await loadContext(request,temp.root,AS_OF);assert.equal(context.provenanceVerified,true);assert.equal(context.currentReport.planStatus,'READY');
  const path=await temp.write('request.json',request),before=captureProtectedTree(repo),raw=await readFile(path);
  const child=spawnSync(process.execPath,['publishing-safety/cli.js','--request',path,'--as-of',AS_OF,'--private-dir',join(temp.root,'out')],{cwd:repo,encoding:'utf8',env:{...process.env,AUTO_PUBLISH:'false'}});
  assert.equal(child.status,0,child.stderr);const result=JSON.parse(child.stdout);assert.equal(result.finalStatus,'COMPLETED');assert.equal(result.AUTO_PUBLISH,false);
  assert.deepEqual(await readFile(path),raw);assertProtectedTreeUnchanged(before,captureProtectedTree(repo));
  await temp.write('planner-report.json',{...report,planStatus:'BLOCKED'});const bad=await loadContext(request,temp.root,AS_OF);assert.equal(bad.provenanceVerified,false);
});
test('CLI rejects action/credential options with no raw input disclosure',async()=>{
  for(const args of [['--publish','true'],['--post','true'],['--browser-profile','PRIVATE_MARKER'],['--request','PRIVATE_MARKER'],['--auto-publish','true']]){
    const child=spawnSync(process.execPath,['publishing-safety/cli.js',...args],{cwd:repo,encoding:'utf8'});assert.equal(child.status,1);assert.equal(child.stdout,'');assert(!child.stderr.includes('PRIVATE_MARKER'));
  }
});
