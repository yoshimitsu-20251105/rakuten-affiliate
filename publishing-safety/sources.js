import { readFile } from 'node:fs/promises';
import { resolve,dirname } from 'node:path';
import { readInputs } from '../acquisition-planner/sources.js';
import { buildReport } from '../acquisition-planner/report.js';
import { assert,hash,timestamp } from './model.js';
export async function loadContext(request,baseDirectory,asOf) {
  asOf=timestamp(asOf);
  const result={asOf,provenanceVerified:false,sourceHashes:{}};
  try {
    const paths={};
    for(const key of ['plannerManifest','plannerReport']) {
      const ref=request[key];assert(ref && typeof ref.path==='string' && /^[a-f0-9]{64}$/.test(ref.sha256));
      const path=resolve(baseDirectory,ref.path);assert(path.endsWith('.json'),'JSON_INPUT_REQUIRED');
      const bytes=await readFile(path);assert(hash(bytes)===ref.sha256,'INPUT_HASH_MISMATCH');
      paths[key]=path;result.sourceHashes[key]=hash(bytes);
      if(key==='plannerReport') result.plannerReport=JSON.parse(bytes);
    }
    const input=await readInputs(paths.plannerManifest,asOf);
    result.selectorReport=input.selectorReport;result.inputHashes=input.hashes;
    result.currentReport=buildReport(input,{runId:'safety-revalidation',generatedAt:asOf,codeCommit:null});
    result.provenanceVerified=true;
  } catch {result.validationError='INPUT_PROVENANCE_INVALID_OR_STALE';}
  return result;
}
