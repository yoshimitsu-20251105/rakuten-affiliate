import { mkdtemp,rm,writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setup,run } from './acquisition-planner-helpers.js';
export { AS_OF } from './acquisition-planner-helpers.js';
export async function fixture() {
  const bundle=await setup({channel:'note'}),report=run(bundle),p=report.plans[0];
  const request={schemaVersion:1,purpose:p.purpose,isSynthetic:true,...Object.fromEntries(['experimentId','candidateId','channel','targetLP','contentUnit','variant','planId'].map(k=>[k,p[k]])),content:'SYNTHETIC TEST DRAFT — NOT A REAL POST',browserProfile:null,dryRun:true};
  const context={plannerReport:report,currentReport:structuredClone(report),selectorReport:bundle.selectorReport,inputHashes:bundle.hashes,sourceHashes:{fixture:'synthetic'},asOf:report.asOf,provenanceVerified:true};
  return {request,context,bundle};
}
export async function temporary(t) {
  const root=await mkdtemp(join(tmpdir(),'publishing-safety-test-'));t.after(()=>rm(root,{recursive:true,force:true}));
  return {root,write:async(name,value)=>{const p=join(root,name);await writeFile(p,typeof value==='string'?value:JSON.stringify(value));return p;}};
}
