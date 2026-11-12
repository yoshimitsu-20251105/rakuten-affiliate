import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile, mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { SENIOR_CAT_TRACKING_TAG, SENIOR_CAT_PATH, SENIOR_CAT_URL, QA_QUERY_PATTERN, seniorCatBusinessPageFilter } from "../../lib/senior-cat-affiliate-measurement.js";
import { fetchGA4PageMetrics } from "../search-trial-analytics-clients.js";
import { permittedSeniorCatTrackingUpdate, permittedSeniorCatQaQueryUpdate, permittedNullObservationUpdate } from "./senior-cat-affiliate-measurement-helpers.js";
import { readAnalyticsObservation } from "../../funnel-measurement/analytics-report-input.js";
import { analytics, analyticsMeta, verified, targetLP, pageHash } from "./funnel-helpers.js";
import { buildSearchTrialReport } from "../search-trial-report-build.js";
import { judgeSearchTrialPage } from "../search-trial-judgment.js";

const repo = fileURLToPath(new URL("../../", import.meta.url));
const source = SENIOR_CAT_TRACKING_TAG.replace(/^<script[^>]*>/, "").replace(/<\/script>$/, "");
function setup({ query = "", path = SENIOR_CAT_PATH, gtagMissing = false } = {}) {
  const calls = [], handlers = [], location = new URL(`https://yoshimitsu-20251105.github.io${path}${query}`);
  const window = { location, ...(gtagMissing ? {} : { gtag: (...args) => calls.push(args) }) };
  const context = vm.createContext({ window, document: { addEventListener: (name, handler, capture) => handlers.push({ name, handler, capture }) }, URL, URLSearchParams, WeakSet });
  const install = () => vm.runInContext(source, context);
  install();
  const click = (href = "https://hb.afl.rakuten.co.jp/hgc/confirmed-existing-link", attrs = {}, event = {}) => {
    const anchor = { href, getAttribute: name => ({ class: "cta-button", "data-item-rank": "1", "data-animal-type": "cat", "data-selection-type": "fixed", "data-page-type": "search_trial_ranking", ...attrs })[name] ?? null };
    const ev = Object.assign(event, { target: { closest: selector => { assert.equal(selector, "a.cta-button[href]"); return anchor; } } });
    for (const { handler } of handlers) handler(ev);
    return ev;
  };
  return { window, calls, handlers, click, install };
}
test("One Rakuten CTA click emits the required explicit event without guessed IDs", () => {
  const b = setup(); b.click();
  assert.equal(b.calls.length, 1); const [kind, name, p] = b.calls[0];
  assert.equal(kind, "event"); assert.equal(name, "affiliate_click");
  assert.equal(p.page_location, SENIOR_CAT_URL); assert.equal(p.page_path, SENIOR_CAT_PATH);
  assert.equal(p.link_domain, "hb.afl.rakuten.co.jp"); assert.equal(p.link_classes, "cta-button");
  assert.equal(p.link_url, "https://hb.afl.rakuten.co.jp/hgc/confirmed-existing-link");
  assert.equal(p.target_lp, SENIOR_CAT_URL); assert.equal(p.affiliate_network, "rakuten");
  assert.equal(p.item_rank, 1); assert.equal(p.animal_type, "cat");
  for (const k of ["item_code", "shop_code", "measurement_id", "experiment_id", "qa_traffic", "debug_mode"]) assert(!Object.hasOwn(p, k));
});
test("Reinstallation or the same event cannot produce duplicate affiliate_click; distinct rapid clicks remain distinct", () => {
  const b = setup(); b.install(); assert.equal(b.handlers.length, 1); assert.equal(b.handlers[0].capture, true);
  const ev = b.click(); b.click(undefined, {}, ev); assert.equal(b.calls.length, 1);
  b.click(); assert.equal(b.calls.length, 2);
});
for (const href of ["/rakuten-affiliate/", "https://example.test/", "https://item.rakuten.co.jp/shop/item", "https://hb.afl.rakuten.co.jp.evil.test/", "https://evil-hb.afl.rakuten.co.jp/", "http://hb.afl.rakuten.co.jp/", "https://hb.afl.rakuten.co.jp:8443/", "https://user@hb.afl.rakuten.co.jp/"])
  test(`Non-affiliate or invalid CTA does not emit: ${href}`, () => { const b = setup(); b.click(href); assert.equal(b.calls.length, 0); });
test("Normal non-CTA links are ignored, including Rakuten links without the CTA class", () => {
  const b = setup(); b.handlers[0].handler({ target: { closest: () => null } }); assert.equal(b.calls.length, 0);
});
test("No installation or QA labeling on another LP", () => {
  const b = setup({ path: "/rakuten-affiliate/rankings/grain-free-dog-food.html", query: "?amv2_qa=1" });
  assert.equal(b.handlers.length, 0); assert.equal(b.calls.length, 0);
});
test("QA labels are queued before GA4 config and retained on the click, without changing the link", () => {
  const b = setup({ query: "?amv2_qa=1&amv2_qa_run=senior-cat-20261110-v1" });
  assert.equal(b.calls[0][0], "set"); assert.equal(b.calls[0][1].debug_mode, true); assert.equal(b.calls[0][1].traffic_type, "qa");
  b.click(); const p = b.calls[1][2]; assert.equal(p.qa_traffic, 1); assert.equal(p.qa_run_id, "senior-cat-20261110-v1");
  assert(p.page_location.includes("amv2_qa=1")); assert(!p.link_url.includes("amv2_qa"));
});
test("Unknown or invalid QA run IDs are omitted; a missing gtag queues rather than throwing", () => {
  const b = setup({ query: "?amv2_qa=1&amv2_qa_run=%3Cinvalid%3E", gtagMissing: true });
  b.click(); assert.equal(b.window.dataLayer.length, 2); assert(!Object.hasOwn(b.window.dataLayer[1][2], "qa_run_id"));
});
for (const query of ["?amv2_qa=0", "?amv2_qa=10", "?other=amv2_qa=1", "?%61mv2_qa=1"])
  test(`QA opt-in is exact and agrees with the API exclusion: ${query}`, () => {
    const b = setup({ query }); b.click(); assert.equal(b.calls.length, 1); assert(!Object.hasOwn(b.calls[0][2], "qa_traffic"));
  });
test("Only this LP's four GA4 requests exclude marked QA via a built-in dimension; no new API/settings", async () => {
  const requests = [], client = { properties: { runReport: async r => { requests.push(r); return { data: { rows: [] } }; } } };
  await fetchGA4PageMetrics({ client, pageUrl: SENIOR_CAT_URL, startDate: "2026-11-10", endDate: "2026-11-10" });
  assert.equal(requests.length, 4);
  for (const r of requests) {
    const expression = JSON.stringify(r.requestBody.dimensionFilter);
    assert(expression.includes('"notExpression"')); assert(expression.includes('"pagePathPlusQueryString"'));
    assert(expression.includes(QA_QUERY_PATTERN));
  }
  const unchanged = seniorCatBusinessPageFilter("/other.html");
  assert.deepEqual(unchanged, { filter: { fieldName: "pagePath", stringFilter: { matchType: "EXACT", value: "/other.html" } } });
});
test("The exclusion fails closed on API rejection; it never retries an unfiltered query", async () => {
  let calls = 0;
  await assert.rejects(fetchGA4PageMetrics({ client: { properties: { runReport: async () => { calls++; throw Error("unsupported dimension"); } } }, pageUrl: SENIOR_CAT_URL, startDate: "2026-11-10", endDate: "2026-11-10" }));
  assert.equal(calls, 1);
});
test("Pilot no-row results stay null; unrelated LP behavior is unchanged and observed zero remains zero", async () => {
  const noRows = { properties: { runReport: async () => ({ data: { rows: [] } }) } };
  const args = { client: noRows, pageUrl: SENIOR_CAT_URL, startDate: "2026-11-10", endDate: "2026-11-10" };
  const r = await fetchGA4PageMetrics(args);
  assert.equal(r.sessions, null); assert.equal(r.affiliateClickEventCount, null); assert.equal(r.affiliateClickRowsStatus, "NO_ROWS_RETURNED");
  const old = await fetchGA4PageMetrics({ ...args, pageUrl: "https://example.test/other.html" });
  assert.equal(old.sessions, 0); assert.equal(old.affiliateClickEventCount, 0); assert(!Object.hasOwn(old, "qaExclusion"));
  let count = 0;
  const observedZero = { properties: { runReport: async () => ({ data: { rows: ++count <= 2 ? [{ metricValues: Array.from({ length: 5 }, () => ({ value: "0" })) }] : [] } }) } };
  const zero = await fetchGA4PageMetrics({ ...args, client: observedZero });
  assert.equal(zero.affiliateClickEventCount, 0); assert.equal(zero.affiliateClickRowsStatus, "OBSERVED");
});
test("Funnel keeps partially observed sessions but does not turn absent affiliate clicks into a zero CTR", () => {
  const r = analytics(); r.pages[0].ga4.affiliateClickEventCount = null;
  const observed = readAnalyticsObservation(r, analyticsMeta(), { targetLP, measurementRecord: verified(), currentPageHash: pageHash });
  assert.equal(observed.sessions.value, 30); assert.equal(observed.affiliateClicks.value, null);
  assert.equal(observed.affiliateClicks.availability, "NO_ROWS_RETURNED"); assert.equal(observed.affiliateCtr.value, null);
});
test("Missing pilot affiliate clicks do not become a 0% rate or a negative LP verdict in the legacy report", async t => {
  const root = await mkdtemp(join(tmpdir(), "senior-cat-null-report-")); t.after(() => rm(root, { recursive: true, force: true }));
  const docsDir = join(root, "docs"); await mkdir(join(docsDir, "rankings"), { recursive: true });
  await writeFile(join(docsDir, "rankings/senior-cat-food.html"), "<html></html>");
  const config = join(root, "config.json"); await writeFile(config, JSON.stringify({ pages: [{ slug: "senior-cat-food", path: "rankings/senior-cat-food.html", title: "SYNTHETIC", status: "search_trial", startDate: "2026-11-10", reviewDate: "2026-11-24", pageType: "search_trial_ranking", sitemapEnabled: true, internalLinkEnabled: true, searchIndexEnabled: true }] }));
  const ga4 = { status: "OK", sessions: 30, screenPageViews: 40, affiliateClickEventCount: null };
  const fetchers = { fetchGA4PageMetrics: async () => ga4, fetchSearchConsolePageMetrics: async () => ({ status: "NOT_AVAILABLE" }), fetchUrlInspectionStatus: async () => ({ status: "INDEX_STATUS_NOT_AVAILABLE" }), fetchGA4CustomDimensionAvailability: async () => ({ status: "NOT_AVAILABLE" }), fetchRakutenPerformance: async () => ({ status: "NOT_CONNECTED" }) };
  const r = await buildSearchTrialReport({ fromDate: "2026-11-10", toDate: "2026-11-10", runId: "synthetic-qa-null", searchTrialConfigPath: config, docsDirPath: `${docsDir}/`, fetchers });
  assert.equal(r.pages[0].rakutenClickRate, "NOT_AVAILABLE");
  const args = { searchConsole: { status: "NOT_AVAILABLE" }, ga4, rakuten: { status: "NOT_CONNECTED" } };
  assert(!judgeSearchTrialPage(args).some(r => r.status === "PAGE_CONVERSION_REVIEW"));
  assert(judgeSearchTrialPage({ ...args, ga4: { ...ga4, affiliateClickEventCount: 0 } }).some(r => r.status === "PAGE_CONVERSION_REVIEW"));
});
test("Only the approved script/QA-filter changes pass protection; CTA, content, configuration and unrelated code mutations fail", async () => {
  for (const [path, allowed] of [["docs/rankings/senior-cat-food.html", permittedSeniorCatTrackingUpdate], ["keyword-research/search-trial-analytics-clients.js", permittedSeniorCatQaQueryUpdate], ...["funnel-measurement/analytics-report-input.js", "keyword-research/search-trial-report-build.js", "keyword-research/search-trial-judgment.js"].map(path => [path, (before, after) => permittedNullObservationUpdate(path, before, after)])]) {
    const before = execFileSync("git", ["show", `a58d2d0579b7b81b2bd4dc88f15e08272dd5a693:${path}`], { cwd: repo, encoding: "utf8" });
    const after = await readFile(new URL(`../../${path}`, import.meta.url), "utf8"); assert(allowed(before, after));
    assert(!allowed(before, after + "\n// unapproved change"));
    if (path.endsWith(".html")) {
      for (const altered of [after.replace("楽天市場で在庫・価格を確認してください", "New CTA"), after.replace("G-5FQMHQ5X6W", "G-OTHER"), after.replace("nyanzaq", "other-shop"), after.replace("<h1>", "<h1>Changed ")]) assert(!allowed(before, altered));
      assert.equal(after.split("gtag('config','G-5FQMHQ5X6W')").length, 2);
      assert(after.indexOf(SENIOR_CAT_TRACKING_TAG) < after.indexOf("gtag('config'"));
    }
  }
});
