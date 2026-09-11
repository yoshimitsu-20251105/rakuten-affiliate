// 【2026-09-17 Phase 3C対応】search-trial-report-build.js のテスト。
// 実際のGA4/Search Console APIは一切呼び出さない(fetchersをすべてfakeに差し替える)。
// 2ページを分離して集計できること、指標が正しく保存されること、CTR・楽天クリック率の
// 計算、分母0の扱い、前回レポートとの差分、楽天成果未接続の扱い、カスタム
// ディメンション未登録時の扱い、API権限不足時の部分レポート、不正な日付・期間外の
// 拒否を検証する。

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildSearchTrialReport, QA_VERIFICATION_DATE } from "../search-trial-report-build.js";

const DOG_SLUG = "senior-dog-pork";
const CAT_SLUG = "grain-free-cat-food";

async function setupFixtureDirs() {
  const root = await mkdtemp(join(tmpdir(), "search-trial-report-build-test-"));
  const docsDir = join(root, "docs") + "/";
  await mkdir(join(docsDir, "rankings"), { recursive: true });
  await writeFile(join(docsDir, "rankings", `${DOG_SLUG}.html`), "<html></html>", "utf-8");
  await writeFile(join(docsDir, "rankings", `${CAT_SLUG}.html`), "<html></html>", "utf-8");

  const configPath = join(root, "search-trial-pages.json");
  await writeFile(
    configPath,
    JSON.stringify({
      pages: [
        {
          slug: DOG_SLUG,
          path: `rankings/${DOG_SLUG}.html`,
          title: "犬ページ",
          status: "search_trial",
          startDate: "2026-09-10",
          reviewDate: "2026-10-10",
          pageType: "search_trial_ranking",
          sitemapEnabled: true,
          internalLinkEnabled: true,
          searchIndexEnabled: true,
        },
        {
          slug: CAT_SLUG,
          path: `rankings/${CAT_SLUG}.html`,
          title: "猫ページ",
          status: "search_trial",
          startDate: "2026-09-10",
          reviewDate: "2026-10-10",
          pageType: "search_trial_ranking",
          sitemapEnabled: true,
          internalLinkEnabled: true,
          searchIndexEnabled: true,
        },
      ],
    }),
    "utf-8"
  );

  return { root, docsDir, configPath };
}

async function cleanup(root) {
  await rm(root, { recursive: true, force: true });
}

function fakeSearchConsoleMetricsByPage(byPage) {
  return async ({ pageUrl }) => {
    const key = Object.keys(byPage).find((slug) => pageUrl.includes(slug));
    return byPage[key] ?? { status: "NOT_AVAILABLE", reason: "not_found_in_fixture" };
  };
}

function fakeGa4MetricsByPage(byPage) {
  return async ({ pageUrl }) => {
    const key = Object.keys(byPage).find((slug) => pageUrl.includes(slug));
    return byPage[key] ?? { status: "NOT_AVAILABLE", reason: "not_found_in_fixture" };
  };
}

function baseFetchers(overrides = {}) {
  return {
    fetchSearchConsolePageMetrics: async () => ({ status: "OK", clicks: 0, impressions: 0, ctr: 0, averagePosition: 0, topQueries: [], byDevice: [], byCountry: [], dataLastAvailableDate: "2026-09-16" }),
    fetchUrlInspectionStatus: async () => ({ status: "OK", indexStatus: "PASS" }),
    fetchGA4PageMetrics: async () => ({ status: "OK", activeUsers: 0, sessions: 0, screenPageViews: 0, engagementRate: 0, averageSessionDuration: 0, affiliateClickEventCount: 0 }),
    fetchGA4CustomDimensionAvailability: async () => ({ status: "OK", registered: { item_rank: false, animal_type: false, selection_type: false, page_type: false } }),
    fetchRakutenPerformance: async () => ({ status: "NOT_CONNECTED", orders: "NOT_CONNECTED", revenue: "NOT_CONNECTED", commission: "NOT_CONNECTED", conversionRate: "NOT_CONNECTED" }),
    ...overrides,
  };
}

test("2ページのデータを分離して集計できる(異なる指標を混同しない)", async () => {
  const { root, docsDir, configPath } = await setupFixtureDirs();
  try {
    const fetchers = baseFetchers({
      fetchSearchConsolePageMetrics: fakeSearchConsoleMetricsByPage({
        [DOG_SLUG]: { status: "OK", clicks: 10, impressions: 200, ctr: 0.05, averagePosition: 8, topQueries: [], byDevice: [], byCountry: [], dataLastAvailableDate: "2026-09-16" },
        [CAT_SLUG]: { status: "OK", clicks: 3, impressions: 90, ctr: 0.03, averagePosition: 15, topQueries: [], byDevice: [], byCountry: [], dataLastAvailableDate: "2026-09-16" },
      }),
      fetchGA4PageMetrics: fakeGa4MetricsByPage({
        [DOG_SLUG]: { status: "OK", activeUsers: 50, sessions: 60, screenPageViews: 80, engagementRate: 0.5, averageSessionDuration: 30, affiliateClickEventCount: 4 },
        [CAT_SLUG]: { status: "OK", activeUsers: 20, sessions: 22, screenPageViews: 25, engagementRate: 0.3, averageSessionDuration: 20, affiliateClickEventCount: 1 },
      }),
    });
    const report = await buildSearchTrialReport({ fromDate: "2026-09-10", toDate: "2026-09-16", runId: "test-run-1", searchTrialConfigPath: configPath, docsDirPath: docsDir, fetchers });

    assert.equal(report.pages.length, 2);
    const dog = report.pages.find((p) => p.slug === DOG_SLUG);
    const cat = report.pages.find((p) => p.slug === CAT_SLUG);
    assert.equal(dog.searchConsole.clicks, 10);
    assert.equal(cat.searchConsole.clicks, 3);
    assert.equal(dog.ga4.screenPageViews, 80);
    assert.equal(cat.ga4.screenPageViews, 25);
    assert.notEqual(dog.ga4.affiliateClickEventCount, cat.ga4.affiliateClickEventCount);
  } finally {
    await cleanup(root);
  }
});

test("Search Console指標(clicks/impressions/ctr/averagePosition/上位クエリ等)を正しく保存する", async () => {
  const { root, docsDir, configPath } = await setupFixtureDirs();
  try {
    const fetchers = baseFetchers({
      fetchSearchConsolePageMetrics: async () => ({
        status: "OK",
        clicks: 42,
        impressions: 777,
        ctr: 0.054,
        averagePosition: 6.5,
        topQueries: [{ query: "シニア犬 豚肉", clicks: 10, impressions: 100, ctr: 0.1, averagePosition: 3 }],
        byDevice: [{ device: "MOBILE", clicks: 30, impressions: 500 }],
        byCountry: [{ country: "jpn", clicks: 40, impressions: 700 }],
        dataLastAvailableDate: "2026-09-16",
      }),
    });
    const report = await buildSearchTrialReport({ fromDate: "2026-09-10", toDate: "2026-09-16", runId: "test-run-2", searchTrialConfigPath: configPath, docsDirPath: docsDir, fetchers });
    const dog = report.pages.find((p) => p.slug === DOG_SLUG);
    assert.equal(dog.searchConsole.clicks, 42);
    assert.equal(dog.searchConsole.impressions, 777);
    assert.equal(dog.searchConsole.ctr, 0.054);
    assert.equal(dog.searchConsole.averagePosition, 6.5);
    assert.equal(dog.searchConsole.topQueries[0].query, "シニア犬 豚肉");
    assert.equal(dog.searchConsole.byDevice[0].device, "MOBILE");
    assert.equal(dog.searchConsole.byCountry[0].country, "jpn");
    assert.equal(dog.searchConsole.dataLastAvailableDate, "2026-09-16");
  } finally {
    await cleanup(root);
  }
});

test("GA4指標(activeUsers/sessions/screenPageViews/engagementRate/averageSessionDuration/affiliate_click)を正しく保存する", async () => {
  const { root, docsDir, configPath } = await setupFixtureDirs();
  try {
    const fetchers = baseFetchers({
      fetchGA4PageMetrics: async () => ({ status: "OK", activeUsers: 100, sessions: 120, screenPageViews: 150, engagementRate: 0.62, averageSessionDuration: 45.5, affiliateClickEventCount: 9 }),
    });
    const report = await buildSearchTrialReport({ fromDate: "2026-09-10", toDate: "2026-09-16", runId: "test-run-3", searchTrialConfigPath: configPath, docsDirPath: docsDir, fetchers });
    const dog = report.pages.find((p) => p.slug === DOG_SLUG);
    assert.equal(dog.ga4.activeUsers, 100);
    assert.equal(dog.ga4.sessions, 120);
    assert.equal(dog.ga4.screenPageViews, 150);
    assert.equal(dog.ga4.engagementRate, 0.62);
    assert.equal(dog.ga4.averageSessionDuration, 45.5);
    assert.equal(dog.ga4.affiliateClickEventCount, 9);
  } finally {
    await cleanup(root);
  }
});

test("楽天クリック率はaffiliate_click eventCount÷screenPageViews×100で計算する", async () => {
  const { root, docsDir, configPath } = await setupFixtureDirs();
  try {
    const fetchers = baseFetchers({
      fetchGA4PageMetrics: async () => ({ status: "OK", activeUsers: 1, sessions: 1, screenPageViews: 50, engagementRate: 0, averageSessionDuration: 0, affiliateClickEventCount: 5 }),
    });
    const report = await buildSearchTrialReport({ fromDate: "2026-09-10", toDate: "2026-09-16", runId: "test-run-4", searchTrialConfigPath: configPath, docsDirPath: docsDir, fetchers });
    const dog = report.pages.find((p) => p.slug === DOG_SLUG);
    assert.equal(dog.rakutenClickRate, 10);
  } finally {
    await cleanup(root);
  }
});

test("楽天クリック率: screenPageViewsが0の場合はNOT_CALCULABLE(0%としない)", async () => {
  const { root, docsDir, configPath } = await setupFixtureDirs();
  try {
    const fetchers = baseFetchers({
      fetchGA4PageMetrics: async () => ({ status: "OK", activeUsers: 0, sessions: 0, screenPageViews: 0, engagementRate: 0, averageSessionDuration: 0, affiliateClickEventCount: 0 }),
    });
    const report = await buildSearchTrialReport({ fromDate: "2026-09-10", toDate: "2026-09-16", runId: "test-run-5", searchTrialConfigPath: configPath, docsDirPath: docsDir, fetchers });
    const dog = report.pages.find((p) => p.slug === DOG_SLUG);
    assert.equal(dog.rakutenClickRate, "NOT_CALCULABLE");
  } finally {
    await cleanup(root);
  }
});

test("前回レポートとの差分計算(数値同士は引き算、比較不能はNOT_COMPARABLE)", async () => {
  const { root, docsDir, configPath } = await setupFixtureDirs();
  try {
    const previousReport = {
      runId: "prev-run",
      pages: [
        { slug: DOG_SLUG, searchConsole: { clicks: 5, impressions: 100, ctr: 0.05, averagePosition: 10 }, ga4: { activeUsers: 10, sessions: 10, screenPageViews: 20, engagementRate: 0.4, averageSessionDuration: 20, affiliateClickEventCount: 1 }, rakutenClickRate: 5 },
      ],
    };
    const fetchers = baseFetchers({
      fetchSearchConsolePageMetrics: async () => ({ status: "OK", clicks: 12, impressions: 150, ctr: 0.08, averagePosition: 7, topQueries: [], byDevice: [], byCountry: [], dataLastAvailableDate: "2026-09-16" }),
      fetchGA4PageMetrics: async () => ({ status: "OK", activeUsers: 25, sessions: 26, screenPageViews: 40, engagementRate: 0.5, averageSessionDuration: 30, affiliateClickEventCount: 4 }),
    });
    const report = await buildSearchTrialReport({ fromDate: "2026-09-10", toDate: "2026-09-16", runId: "test-run-6", searchTrialConfigPath: configPath, docsDirPath: docsDir, fetchers, previousReport });

    assert.equal(report.diffFromPrevious.previousRunId, "prev-run");
    const dogDiff = report.diffFromPrevious.pages.find((p) => p.slug === DOG_SLUG).diff;
    assert.equal(dogDiff.searchConsole.clicks, 7); // 12-5
    assert.equal(dogDiff.ga4.screenPageViews, 20); // 40-20
    assert.equal(dogDiff.ga4.affiliateClickEventCount, 3); // 4-1

    const catDiff = report.diffFromPrevious.pages.find((p) => p.slug === CAT_SLUG).diff;
    assert.equal(catDiff, null, "前回レポートに存在しないページはdiffがnull(比較不能)");
  } finally {
    await cleanup(root);
  }
});

test("previousReport未指定の場合、diffFromPreviousはnull", async () => {
  const { root, docsDir, configPath } = await setupFixtureDirs();
  try {
    const report = await buildSearchTrialReport({ fromDate: "2026-09-10", toDate: "2026-09-16", runId: "test-run-7", searchTrialConfigPath: configPath, docsDirPath: docsDir, fetchers: baseFetchers() });
    assert.equal(report.diffFromPrevious, null);
  } finally {
    await cleanup(root);
  }
});

test("楽天成果が未接続(NOT_CONNECTED)の場合、0件と表示せずNOT_CONNECTEDのまま保持する", async () => {
  const { root, docsDir, configPath } = await setupFixtureDirs();
  try {
    const report = await buildSearchTrialReport({ fromDate: "2026-09-10", toDate: "2026-09-16", runId: "test-run-8", searchTrialConfigPath: configPath, docsDirPath: docsDir, fetchers: baseFetchers() });
    const dog = report.pages.find((p) => p.slug === DOG_SLUG);
    assert.equal(dog.rakuten.status, "NOT_CONNECTED");
    assert.equal(dog.rakuten.orders, "NOT_CONNECTED");
    assert.notEqual(dog.rakuten.orders, 0);
    assert.ok(report.dataGaps.some((g) => g.item === "rakuten" && g.reason === "NOT_CONNECTED"));
  } finally {
    await cleanup(root);
  }
});

test("GA4カスタムディメンション未登録の場合、CUSTOM_DIMENSION_NOT_REGISTEREDとしてdataGapsへ記録する(推測しない)", async () => {
  const { root, docsDir, configPath } = await setupFixtureDirs();
  try {
    const fetchers = baseFetchers({
      fetchGA4CustomDimensionAvailability: async () => ({ status: "OK", registered: { item_rank: false, animal_type: true, selection_type: false, page_type: false } }),
    });
    const report = await buildSearchTrialReport({ fromDate: "2026-09-10", toDate: "2026-09-16", runId: "test-run-9", searchTrialConfigPath: configPath, docsDirPath: docsDir, fetchers });
    assert.equal(report.customDimensionAvailability.registered.animal_type, true);
    assert.equal(report.customDimensionAvailability.registered.item_rank, false);
    assert.ok(report.dataGaps.some((g) => g.item === "ga4CustomDimension:item_rank"));
    assert.ok(!report.dataGaps.some((g) => g.item === "ga4CustomDimension:animal_type"));
  } finally {
    await cleanup(root);
  }
});

test("API権限不足時は該当項目だけをNOT_AVAILABLEにして、他の取得できた項目は保持する(部分レポート)", async () => {
  const { root, docsDir, configPath } = await setupFixtureDirs();
  try {
    const fetchers = baseFetchers({
      fetchSearchConsolePageMetrics: async () => ({ status: "NOT_AVAILABLE", reason: "permission_denied" }),
      fetchGA4PageMetrics: async () => ({ status: "OK", activeUsers: 30, sessions: 31, screenPageViews: 40, engagementRate: 0.4, averageSessionDuration: 25, affiliateClickEventCount: 2 }),
    });
    const report = await buildSearchTrialReport({ fromDate: "2026-09-10", toDate: "2026-09-16", runId: "test-run-10", searchTrialConfigPath: configPath, docsDirPath: docsDir, fetchers });
    const dog = report.pages.find((p) => p.slug === DOG_SLUG);
    assert.equal(dog.searchConsole.status, "NOT_AVAILABLE");
    assert.equal(dog.ga4.status, "OK");
    assert.equal(dog.ga4.screenPageViews, 40, "Search Console取得不能でもGA4の取得できた値は失われないこと");
    assert.ok(report.dataGaps.some((g) => g.item === "searchConsole" && g.reason === "permission_denied"));
  } finally {
    await cleanup(root);
  }
});

test("不正な日付形式は拒否する", async () => {
  const { root, docsDir, configPath } = await setupFixtureDirs();
  try {
    await assert.rejects(
      () => buildSearchTrialReport({ fromDate: "2026/09/10", toDate: "2026-09-16", runId: "test-run-11", searchTrialConfigPath: configPath, docsDirPath: docsDir, fetchers: baseFetchers() }),
      /from/
    );
  } finally {
    await cleanup(root);
  }
});

test("fromがtoより後の場合は拒否する", async () => {
  const { root, docsDir, configPath } = await setupFixtureDirs();
  try {
    await assert.rejects(
      () => buildSearchTrialReport({ fromDate: "2026-09-16", toDate: "2026-09-10", runId: "test-run-12", searchTrialConfigPath: configPath, docsDirPath: docsDir, fetchers: baseFetchers() }),
      /toより後/
    );
  } finally {
    await cleanup(root);
  }
});

test("対象期間が試験期間(startDate〜reviewDate)の範囲外の場合は拒否する", async () => {
  const { root, docsDir, configPath } = await setupFixtureDirs();
  try {
    await assert.rejects(
      () => buildSearchTrialReport({ fromDate: "2026-08-01", toDate: "2026-08-07", runId: "test-run-13", searchTrialConfigPath: configPath, docsDirPath: docsDir, fetchers: baseFetchers() }),
      /試験期間/
    );
  } finally {
    await cleanup(root);
  }
});

test("runIdが不正(記号を含む)な場合は拒否する", async () => {
  const { root, docsDir, configPath } = await setupFixtureDirs();
  try {
    await assert.rejects(
      () => buildSearchTrialReport({ fromDate: "2026-09-10", toDate: "2026-09-16", runId: "bad run id!", searchTrialConfigPath: configPath, docsDirPath: docsDir, fetchers: baseFetchers() }),
      /runId/
    );
  } finally {
    await cleanup(root);
  }
});

test("設定JSONが不正な場合は拒否する(lib/search-trial-config.jsの検証を再利用)", async () => {
  const { root, docsDir } = await setupFixtureDirs();
  try {
    const badConfigPath = join(root, "bad-config.json");
    await writeFile(badConfigPath, "{ not valid json", "utf-8");
    await assert.rejects(() => buildSearchTrialReport({ fromDate: "2026-09-10", toDate: "2026-09-16", runId: "test-run-14", searchTrialConfigPath: badConfigPath, docsDirPath: docsDir, fetchers: baseFetchers() }));
  } finally {
    await cleanup(root);
  }
});

test("対象ページが重複(slug重複)している場合は拒否する(lib/search-trial-config.jsの検証を再利用)", async () => {
  const { root, docsDir } = await setupFixtureDirs();
  try {
    const dupConfigPath = join(root, "dup-config.json");
    const page = {
      slug: DOG_SLUG,
      path: `rankings/${DOG_SLUG}.html`,
      title: "犬ページ",
      status: "search_trial",
      startDate: "2026-09-10",
      reviewDate: "2026-10-10",
      pageType: "search_trial_ranking",
      sitemapEnabled: true,
      internalLinkEnabled: true,
      searchIndexEnabled: true,
    };
    await writeFile(dupConfigPath, JSON.stringify({ pages: [page, { ...page }] }), "utf-8");
    await assert.rejects(() => buildSearchTrialReport({ fromDate: "2026-09-10", toDate: "2026-09-16", runId: "test-run-15", searchTrialConfigPath: dupConfigPath, docsDirPath: docsDir, fetchers: baseFetchers() }), /重複/);
  } finally {
    await cleanup(root);
  }
});

test("Search Console/GA4のレスポンス形状が不正な場合(fetcherが例外を投げる)、レポート生成全体を失敗させる", async () => {
  const { root, docsDir, configPath } = await setupFixtureDirs();
  try {
    const fetchers = baseFetchers({
      fetchGA4PageMetrics: async () => {
        throw new Error("GA4応答の形状が想定と異なります(rowsが配列ではありません)");
      },
    });
    await assert.rejects(() => buildSearchTrialReport({ fromDate: "2026-09-10", toDate: "2026-09-16", runId: "test-run-16", searchTrialConfigPath: configPath, docsDirPath: docsDir, fetchers }), /形状/);
  } finally {
    await cleanup(root);
  }
});

test("対象期間に2026-09-10(本番動作確認日)を含む場合、QA確認クリックの注記を付ける", async () => {
  const { root, docsDir, configPath } = await setupFixtureDirs();
  try {
    const report = await buildSearchTrialReport({ fromDate: QA_VERIFICATION_DATE, toDate: "2026-09-16", runId: "test-run-17", searchTrialConfigPath: configPath, docsDirPath: docsDir, fetchers: baseFetchers() });
    assert.ok(report.qaClickNotice);
    assert.match(report.qaClickNotice, /本番動作確認用クリック/);
  } finally {
    await cleanup(root);
  }
});

test("対象期間が2026-09-10を含まない場合、QA確認クリックの注記は付けない", async () => {
  const { root, docsDir, configPath } = await setupFixtureDirs();
  try {
    const report = await buildSearchTrialReport({ fromDate: "2026-09-11", toDate: "2026-09-16", runId: "test-run-18", searchTrialConfigPath: configPath, docsDirPath: docsDir, fetchers: baseFetchers() });
    assert.equal(report.qaClickNotice, null);
  } finally {
    await cleanup(root);
  }
});

test("QA確認クリックは取得値から自動的に差し引かない(fetcherが返した値がそのまま保持される)", async () => {
  const { root, docsDir, configPath } = await setupFixtureDirs();
  try {
    const fetchers = baseFetchers({
      fetchGA4PageMetrics: async () => ({ status: "OK", activeUsers: 1, sessions: 1, screenPageViews: 1, engagementRate: 1, averageSessionDuration: 1, affiliateClickEventCount: 1 }),
    });
    const report = await buildSearchTrialReport({ fromDate: QA_VERIFICATION_DATE, toDate: QA_VERIFICATION_DATE, runId: "test-run-19", searchTrialConfigPath: configPath, docsDirPath: docsDir, fetchers });
    const dog = report.pages.find((p) => p.slug === DOG_SLUG);
    assert.equal(dog.ga4.affiliateClickEventCount, 1, "自動的な差し引きは行わないこと");
  } finally {
    await cleanup(root);
  }
});
