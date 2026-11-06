#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { resolve,dirname } from 'node:path';
import { assert } from './model.js';
import { DEFAULT_ROOT } from './store.js';
import { loadContext } from './sources.js';
import { runSafety } from './runner.js';
async function main() {
  const args={},allowed=['request','private-dir','as-of'];
  for(let i=2;i<process.argv.length;i+=2){const key=process.argv[i].slice(2),value=process.argv[i+1];assert(process.argv[i].startsWith('--')&&allowed.includes(key)&&value&&!value.startsWith('--')&&!Object.hasOwn(args,key));args[key]=value;}
  assert(args.request,'REQUEST_REQUIRED');const path=resolve(args.request),request=JSON.parse(await readFile(path,'utf8'));
  const asOf=args['as-of']??new Date().toISOString(),context=await loadContext(request,dirname(path),asOf);
  const result=await runSafety(args['private-dir']?resolve(args['private-dir']):DEFAULT_ROOT,request,context);
  console.log(JSON.stringify({status:result.status,runId:result.run.runId,finalStatus:result.run.finalStatus,errorReason:result.run.errorReason,currentCheckStatus:result.currentCheckStatus??null,currentBlockingReasons:result.currentBlockingReasons??[],AUTO_PUBLISH:false,canPublish:false,canPost:false,canStartExperiment:false}));
}
main().catch(()=>{console.error('[publishing-safety] Validation, ledger or lock failure; private details omitted. No publication performed.');process.exitCode=1;});
