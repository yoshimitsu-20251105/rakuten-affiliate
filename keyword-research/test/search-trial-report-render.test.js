// 【2026-09-17 Phase 3C対応】search-trial-report-render.js のテスト。
// report.md/report.jsonが事実・計算値・未取得を混同せずに表示すること、
// 楽天成果NOT_CONNECTEDを0件のように見せないことを確認する。

import { test } from "node:test";
import assert from "node:assert/strict";
import { renderReportMarkdown, renderReportJson } from "../search-trial-report-render.js";

function baseReport(overrides = {}) {
  return {
    runId: "test-run",
    generatedAt: "2026-09-17T00:00:00.000Z",
    requestedPeriod: { from: "2026-09-10", to: "2026-09-16" },
    trialPeriod: { startDate: "2026-09-10", reviewDate: "2026-10-10" },
    qaClickNotice: null,
    customDimensionAvailability: { status: "OK", registered: { item_rank: false, animal_type: false, selection_type: false, page_type: false } },
    pages: [
      {
        slug: "senior-dog-pork",
        path: "rankings/senior-dog-pork.html",
        title: "犬ページ",
        pageUrl: "https://example.test/rankings/senior-dog-pork.html",
        searchConsole: { status: "OK", clicks: 10, impressions: 200, ctr: 0.05, averagePosition: 8, topQueries: [], byDevice: [], byCountry: [], dataLastAvailableDate: "2026-09-16" },
        urlInspection: { status: "OK", indexStatus: "PASS" },
        ga4: { status: "OK", activeUsers: 50, sessions: 60, screenPageViews: 80, engagementRate: 0.5, averageSessionDuration: 30, affiliateClickEventCount: 4 },
        rakuten: { status: "NOT_CONNECTED", orders: "NOT_CONNECTED", revenue: "NOT_CONNECTED", commission: "NOT_CONNECTED", conversionRate: "NOT_CONNECTED" },
        rakutenClickRate: 5,
        judgment: [],
      },
    ],
    diffFromPrevious: null,
    dataGaps: [],
    ...overrides,
  };
}

test("report.mdは業界標準ではなく暫定基準であることを明記する", () => {
  const md = renderReportMarkdown(baseReport());
  assert.match(md, /業界標準ではなく/);
});

test("report.mdは楽天成果NOT_CONNECTEDを0件のように見せない", () => {
  const md = renderReportMarkdown(baseReport());
  assert.match(md, /NOT_CONNECTED/);
  assert.doesNotMatch(md, /注文件数.*0件/);
});

test("report.mdはQA確認クリックの注記がある場合に表示する", () => {
  const md = renderReportMarkdown(baseReport({ qaClickNotice: "2026年9月10日の計測値には、本番動作確認用クリックが含まれる可能性があります。" }));
  assert.match(md, /本番動作確認用クリック/);
});

test("report.mdはQA確認クリックの注記が無い場合は表示しない", () => {
  const md = renderReportMarkdown(baseReport({ qaClickNotice: null }));
  assert.doesNotMatch(md, /本番動作確認用クリック/);
});

test("report.mdは楽天クリック率の計算根拠を明記する", () => {
  const md = renderReportMarkdown(baseReport());
  assert.match(md, /affiliate_click eventCount ÷ screenPageViews × 100/);
});

test("report.mdはNOT_CALCULABLEを0%と表示しない", () => {
  const report = baseReport();
  report.pages[0].rakutenClickRate = "NOT_CALCULABLE";
  const md = renderReportMarkdown(report);
  const clickRateLine = md.split("\n").find((l) => l.includes("楽天CTAクリック率") === false && l.startsWith("- NOT_CALCULABLE"));
  assert.ok(clickRateLine, "楽天クリック率の行がNOT_CALCULABLEで始まること");
  assert.doesNotMatch(clickRateLine, /%/);
});

test("report.mdはCUSTOM_DIMENSION_NOT_REGISTEREDを推測値として表示しない", () => {
  const md = renderReportMarkdown(baseReport());
  assert.match(md, /CUSTOM_DIMENSION_NOT_REGISTERED/);
});

test("report.mdはデータ不足・取得不能項目のセクションを持つ", () => {
  const report = baseReport({ dataGaps: [{ slug: "senior-dog-pork", item: "searchConsole", reason: "permission_denied" }] });
  const md = renderReportMarkdown(report);
  assert.match(md, /データ不足・取得不能項目/);
  assert.match(md, /permission_denied/);
});

test("report.mdは次回確認日(reviewDate)を含む", () => {
  const md = renderReportMarkdown(baseReport());
  assert.match(md, /2026-10-10/);
});

test("report.jsonはレポートオブジェクトをそのまま復元可能な形で出力する", () => {
  const report = baseReport();
  const json = renderReportJson(report);
  const parsed = JSON.parse(json);
  assert.deepEqual(parsed, report);
});
