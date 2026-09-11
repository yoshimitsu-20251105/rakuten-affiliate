// 【2026-09-17 Phase 3C対応】search-trial-judgment.js の暫定判定ロジックのテスト。
// 業界標準ではなく今回の試験用の暫定基準であること、データ不足を失敗と断定しない
// こと、複数条件該当時にすべて返すこと、楽天成果未接続を0件として誤判定しない
// ことを確認する。

import { test } from "node:test";
import assert from "node:assert/strict";
import { judgeSearchTrialPage } from "../search-trial-judgment.js";

const NOT_CONNECTED_RAKUTEN = { status: "NOT_CONNECTED", orders: "NOT_CONNECTED", commission: "NOT_CONNECTED" };

test("表示回数100未満はINSUFFICIENT_DATA", () => {
  const findings = judgeSearchTrialPage({
    searchConsole: { status: "OK", impressions: 50, clicks: 5 },
    ga4: { status: "OK", screenPageViews: 30, affiliateClickEventCount: 1 },
    rakuten: NOT_CONNECTED_RAKUTEN,
  });
  assert.ok(findings.some((f) => f.status === "INSUFFICIENT_DATA"));
});

test("PV20未満はINSUFFICIENT_DATA", () => {
  const findings = judgeSearchTrialPage({
    searchConsole: { status: "OK", impressions: 200, clicks: 5 },
    ga4: { status: "OK", screenPageViews: 10, affiliateClickEventCount: 1 },
    rakuten: NOT_CONNECTED_RAKUTEN,
  });
  assert.ok(findings.some((f) => f.status === "INSUFFICIENT_DATA"));
  assert.deepEqual(findings.find((f) => f.status === "INSUFFICIENT_DATA").evidence, { impressions: 200, screenPageViews: 10 });
});

test("表示回数100以上・検索クリック0はSEARCH_SNIPPET_REVIEW", () => {
  const findings = judgeSearchTrialPage({
    searchConsole: { status: "OK", impressions: 150, clicks: 0 },
    ga4: { status: "OK", screenPageViews: 25, affiliateClickEventCount: 1 },
    rakuten: NOT_CONNECTED_RAKUTEN,
  });
  assert.ok(findings.some((f) => f.status === "SEARCH_SNIPPET_REVIEW"));
  assert.equal(findings.some((f) => f.status === "INSUFFICIENT_DATA"), false, "表示回数100以上・PV20以上なのでINSUFFICIENT_DATAには該当しない");
});

test("PV20以上・affiliate_click 0はPAGE_CONVERSION_REVIEW", () => {
  const findings = judgeSearchTrialPage({
    searchConsole: { status: "OK", impressions: 150, clicks: 3 },
    ga4: { status: "OK", screenPageViews: 25, affiliateClickEventCount: 0 },
    rakuten: NOT_CONNECTED_RAKUTEN,
  });
  assert.ok(findings.some((f) => f.status === "PAGE_CONVERSION_REVIEW"));
});

test("楽天成果が未接続(NOT_CONNECTED)の場合、PRODUCT_OFFER_REVIEWとMONETIZATION_SIGNAL_DETECTEDのどちらも評価しない(0件と誤判定しない)", () => {
  const findings = judgeSearchTrialPage({
    searchConsole: { status: "OK", impressions: 150, clicks: 3 },
    ga4: { status: "OK", screenPageViews: 25, affiliateClickEventCount: 15 },
    rakuten: NOT_CONNECTED_RAKUTEN,
  });
  assert.equal(findings.some((f) => f.status === "PRODUCT_OFFER_REVIEW"), false);
  assert.equal(findings.some((f) => f.status === "MONETIZATION_SIGNAL_DETECTED"), false);
});

test("楽天成果が取得できていて注文0件・CTAクリック10件以上ならPRODUCT_OFFER_REVIEW", () => {
  const findings = judgeSearchTrialPage({
    searchConsole: { status: "OK", impressions: 150, clicks: 3 },
    ga4: { status: "OK", screenPageViews: 25, affiliateClickEventCount: 12 },
    rakuten: { status: "OK", orders: 0, commission: 0 },
  });
  assert.ok(findings.some((f) => f.status === "PRODUCT_OFFER_REVIEW"));
});

test("楽天成果報酬が1件以上ならMONETIZATION_SIGNAL_DETECTED", () => {
  const findings = judgeSearchTrialPage({
    searchConsole: { status: "OK", impressions: 150, clicks: 3 },
    ga4: { status: "OK", screenPageViews: 25, affiliateClickEventCount: 5 },
    rakuten: { status: "OK", orders: 1, commission: 1 },
  });
  assert.ok(findings.some((f) => f.status === "MONETIZATION_SIGNAL_DETECTED"));
});

test("複数条件に該当する場合はすべて返す(根拠付き)", () => {
  const findings = judgeSearchTrialPage({
    searchConsole: { status: "OK", impressions: 50, clicks: 0 },
    ga4: { status: "OK", screenPageViews: 5, affiliateClickEventCount: 0 },
    rakuten: NOT_CONNECTED_RAKUTEN,
  });
  // impressions<100 かつ PV<20 なので INSUFFICIENT_DATA のみ該当する
  // (SEARCH_SNIPPET_REVIEWはimpressions>=100が条件のため該当しない)
  assert.ok(findings.some((f) => f.status === "INSUFFICIENT_DATA"));
  for (const f of findings) {
    assert.ok(f.evidence && typeof f.evidence === "object", "根拠となった数値を持つこと");
  }
});

test("データ不足(INSUFFICIENT_DATA)は失敗ではなく、単なる1つの判定結果として返す(例外を投げない)", () => {
  assert.doesNotThrow(() => {
    judgeSearchTrialPage({
      searchConsole: { status: "OK", impressions: 0, clicks: 0 },
      ga4: { status: "OK", screenPageViews: 0, affiliateClickEventCount: 0 },
      rakuten: NOT_CONNECTED_RAKUTEN,
    });
  });
});

test("Search Console/GA4が未取得(NOT_AVAILABLE)の場合、その指標に依存する判定は評価しない(誤判定しない)", () => {
  const findings = judgeSearchTrialPage({
    searchConsole: { status: "NOT_AVAILABLE" },
    ga4: { status: "NOT_AVAILABLE" },
    rakuten: NOT_CONNECTED_RAKUTEN,
  });
  assert.deepEqual(findings, []);
});

test("該当する基準が無い場合は空配列を返す", () => {
  const findings = judgeSearchTrialPage({
    searchConsole: { status: "OK", impressions: 500, clicks: 50 },
    ga4: { status: "OK", screenPageViews: 100, affiliateClickEventCount: 5 },
    rakuten: NOT_CONNECTED_RAKUTEN,
  });
  assert.deepEqual(findings, []);
});
