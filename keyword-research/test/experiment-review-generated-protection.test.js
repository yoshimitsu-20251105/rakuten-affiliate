import test from "node:test";
import assert from "node:assert/strict";
import { permittedGeneratedUpdate as allowed, assertProtectedTreeUnchanged } from "./experiment-review-protection-helpers.js";
import { contentHash } from "../../lib/sitemap-lastmod.js";
import { assertHistoricalProtection } from './experiment-review-protection-helpers.js';
import { mkdtemp,mkdir,writeFile,rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';

test("Expired urgency removal is allowed, while article CTA, affiliate URL and claims remain protected", () => {
  const old = '<h1>Product</h1>\n<p class="urgency">10/31まで</p>\n<a href="https://example.com/offer">CTA</a>';
  const current = old.replace('<p class="urgency">10/31まで</p>', '');
  assert(allowed("docs/articles/item.html", old, current));
  assert(!allowed("docs/articles/item.html", old, current.replace('CTA', 'Buy now')));
  assert(!allowed("docs/articles/item.html", old, current.replace('/offer', '/different')));
  assert(!allowed("docs/articles/item.html", old, old.replace('10/31まで', 'New unsupported claim')));
  assert(!allowed("docs/articles/item.html", old, old+'<p class="urgency">10/31まで</p>'));
});
test('Real Git baseline accepts normal regeneration and still detects Planner/Selector code or affiliate-link mutation',async(t)=>{
  const repo=await mkdtemp(join(tmpdir(),'protected-guard-fixture-'));t.after(()=>rm(repo,{recursive:true,force:true}));
  const git=(...args)=>execFileSync('git',args,{cwd:repo,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  const write=async(path,text)=>{const full=join(repo,path);await mkdir(join(full,'..'),{recursive:true});await writeFile(full,text);};
  const old='<p class="urgency">10/31まで</p>\n<a href="https://example.com/offer">CTA</a>',current=old.replace('<p class="urgency">10/31まで</p>','');
  await write('acquisition-planner/gates.js','export const canPost=false;');await write('experiment-selector/select.js','export const canStart=false;');
  await write('docs/articles/item.html',old);await write('docs/sitemap.xml','<url><loc>https://example.com/item</loc></url>');
  await write('sitemap-lastmod.json',JSON.stringify({'articles/item.html':{hash:contentHash(old),lastmod:null}}));
  git('init','-q');git('add','.');git('-c','user.name=Synthetic Guard Test','-c','user.email=synthetic@example.test','commit','-qm','synthetic baseline');
  const base=git('rev-parse','HEAD'),config={base,modules:{'acquisition-planner':base,'experiment-selector':base}};
  await write('docs/articles/item.html',current);await write('docs/sitemap.xml','<url><loc>https://example.com/item</loc><lastmod>2026-11-01</lastmod></url>');
  await write('sitemap-lastmod.json',JSON.stringify({'articles/item.html':{hash:contentHash(current),lastmod:'2026-11-01'}}));
  assertHistoricalProtection(repo,config);
  for(const [path,before] of [['acquisition-planner/gates.js','export const canPost=false;'],['experiment-selector/select.js','export const canStart=false;']]) {
    await write(path,'export const bypass=true;');assert.throws(()=>assertHistoricalProtection(repo,config));await write(path,before);
  }
  await write('docs/articles/item.html',current.replace('/offer','/other'));assert.throws(()=>assertHistoricalProtection(repo,config));
});
test("Date-only generated updates do not exempt fixed LP or source changes", () => {
  const old = '情報取得日: 2026年10月31日', current = '情報取得日: 2026年11月1日';
  assert(allowed('docs/articles/item.html', old, current));
  for (const path of ['docs/rankings/experiment.html','strategy/experiments.json','acquisition-planner/model.js','experiment-selector/gates.js']) assert(!allowed(path, old, current));
});
test("Sitemap dates may change but URL additions/deletions cannot hide in generated output", () => {
  const xml = '<url><loc>https://example.com/item</loc></url>';
  assert(allowed('docs/sitemap.xml', xml, xml.replace('</url>', '<lastmod>2026-11-01</lastmod></url>')));
  assert(!allowed('docs/sitemap.xml', xml, xml.replace('/item','/other')));
});
test("Lastmod changes must retain page identities and match actual semantic HTML hash", () => {
  const old=JSON.stringify({'articles/item.html':{hash:'old',lastmod:null}}), page='<h1>Product</h1>';
  const current=JSON.stringify({'articles/item.html':{hash:contentHash(page),lastmod:'2026-11-01'}});
  assert(allowed('sitemap-lastmod.json',old,current,()=>page));
  assert(!allowed('sitemap-lastmod.json',old,current,()=>'<h1>Different</h1>'));
  assert(!allowed('sitemap-lastmod.json',old,'{}',()=>page));
});
test("Execution snapshot detects modifications, deletions and additions in code AND generated assets", () => {
  const before={'acquisition-planner/gates.js':'a','experiment-selector/select.js':'b','docs/articles/item.html':'c','docs/sitemap.xml':'d','sitemap-lastmod.json':'e'};
  assertProtectedTreeUnchanged(before,{...before});
  for(const path of Object.keys(before)) {
    assert.throws(()=>assertProtectedTreeUnchanged(before,{...before,[path]:'changed'}));
    const removed={...before};delete removed[path];assert.throws(()=>assertProtectedTreeUnchanged(before,removed));
  }
  assert.throws(()=>assertProtectedTreeUnchanged(before,{...before,'docs/new.html':'x'}));
});
