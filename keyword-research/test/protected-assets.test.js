import test from "node:test";
import assert from "node:assert/strict";
import { permittedGeneratedUpdate as allowed, assertProtectedTreeUnchanged } from "./protected-assets-helpers.js";
import { contentHash } from "../../lib/sitemap-lastmod.js";

test("Expired urgency removal is allowed, while article CTA, affiliate URL and claims remain protected", () => {
  const old = '<h1>Product</h1>\n<p class="urgency">10/31まで</p>\n<a href="https://example.com/offer">CTA</a>';
  const current = old.replace('<p class="urgency">10/31まで</p>', '');
  assert(allowed("docs/articles/item.html", old, current));
  assert(!allowed("docs/articles/item.html", old, current.replace('CTA', 'Buy now')));
  assert(!allowed("docs/articles/item.html", old, current.replace('/offer', '/different')));
  assert(!allowed("docs/articles/item.html", old, old.replace('10/31まで', 'New unsupported claim')));
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
