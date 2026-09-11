// Phase 3C(検索公開試験レポート)専用: レポート組み立てのオーケストレーション層
// (2026-09-17対応)。
//
// 対象ページはkeyword-research/search-trial-pages.json(既存のlib/search-trial-config.js
// で検証済み)から取得し、URL・slugをこの層でハードコードしない。GA4・Search Console
// APIへのアクセスはfetchers引数経由(既定は実装本体のsearch-trial-analytics-clients.js)
// にして、テストからは実装を差し替えられるようにする(テスト中の外部API呼び出しを0件にする)。
//
// 検証(日付形式・from<=to・試験期間内・runId形式・設定JSON妥当性)はすべて、
// 実際のデータ取得やファイル書き込みより前に行う。1つでも失敗すれば例外を投げ、
// 呼び出し側(CLI)は何も書き込まない。

import { loadSearchTrialConfig } from "../lib/search-trial-config.js";
import { judgeSearchTrialPage } from "./search-trial-judgment.js";
import { SITE_URL } from "../lib/site-config.js";
import * as defaultFetchers from "./search-trial-analytics-clients.js";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const RUN_ID_RE = /^[A-Za-z0-9_-]+$/;

// 2026-09-10は本番動作確認(PR #12マージ後の実サイト確認)でCTAを実際にクリックした日。
// このセッションでは実際のGA4への送信は行っていない(window.gtagをテスト用に差し替えて
// 実送信を抑止済み)が、確証はできないため、対象期間にこの日を含む場合は必ず注記する。
export const QA_VERIFICATION_DATE = "2026-09-10";
export const QA_VERIFICATION_NOTICE =
  "2026年9月10日の計測値には、本番動作確認用クリックが含まれる可能性があります。";

function assertValidDate(label, value) {
  if (typeof value !== "string" || !DATE_RE.test(value)) {
    throw new Error(`${label}はYYYY-MM-DD形式で指定してください(指定値: ${value})`);
  }
  const t = Date.parse(`${value}T00:00:00Z`);
  if (Number.isNaN(t)) {
    throw new Error(`${label}が実在する日付ではありません(指定値: ${value})`);
  }
}

function toEpoch(dateStr) {
  return Date.parse(`${dateStr}T00:00:00Z`);
}

function periodIncludesDate(fromDate, toDate, dateStr) {
  const d = toEpoch(dateStr);
  return d >= toEpoch(fromDate) && d <= toEpoch(toDate);
}

function pageUrlFor(page) {
  return `${SITE_URL}/${page.path}`;
}

function computeRakutenClickRate(ga4) {
  if (ga4.status !== "OK") return "NOT_AVAILABLE";
  if (!ga4.screenPageViews) return "NOT_CALCULABLE";
  return (ga4.affiliateClickEventCount / ga4.screenPageViews) * 100;
}

function numericOrUndefined(v) {
  return typeof v === "number" ? v : undefined;
}

function diffValue(current, previous) {
  const c = numericOrUndefined(current);
  const p = numericOrUndefined(previous);
  if (c === undefined || p === undefined) return "NOT_COMPARABLE";
  return c - p;
}

function buildDiffForPage(currentPage, previousPage) {
  if (!previousPage) return null;
  return {
    searchConsole: {
      clicks: diffValue(currentPage.searchConsole?.clicks, previousPage.searchConsole?.clicks),
      impressions: diffValue(currentPage.searchConsole?.impressions, previousPage.searchConsole?.impressions),
      ctr: diffValue(currentPage.searchConsole?.ctr, previousPage.searchConsole?.ctr),
      averagePosition: diffValue(currentPage.searchConsole?.averagePosition, previousPage.searchConsole?.averagePosition),
    },
    ga4: {
      activeUsers: diffValue(currentPage.ga4?.activeUsers, previousPage.ga4?.activeUsers),
      sessions: diffValue(currentPage.ga4?.sessions, previousPage.ga4?.sessions),
      screenPageViews: diffValue(currentPage.ga4?.screenPageViews, previousPage.ga4?.screenPageViews),
      engagementRate: diffValue(currentPage.ga4?.engagementRate, previousPage.ga4?.engagementRate),
      averageSessionDuration: diffValue(currentPage.ga4?.averageSessionDuration, previousPage.ga4?.averageSessionDuration),
      affiliateClickEventCount: diffValue(currentPage.ga4?.affiliateClickEventCount, previousPage.ga4?.affiliateClickEventCount),
    },
    rakutenClickRate: diffValue(currentPage.rakutenClickRate, previousPage.rakutenClickRate),
  };
}

function collectDataGaps(pages, customDimensionAvailability) {
  const gaps = [];
  for (const p of pages) {
    if (p.searchConsole.status !== "OK") gaps.push({ slug: p.slug, item: "searchConsole", reason: p.searchConsole.reason ?? p.searchConsole.status });
    if (p.urlInspection.status !== "OK") gaps.push({ slug: p.slug, item: "urlInspection", reason: p.urlInspection.reason ?? p.urlInspection.status });
    if (p.ga4.status !== "OK") gaps.push({ slug: p.slug, item: "ga4", reason: p.ga4.reason ?? p.ga4.status });
    if (p.rakuten.status === "NOT_CONNECTED") gaps.push({ slug: p.slug, item: "rakuten", reason: "NOT_CONNECTED" });
  }
  if (customDimensionAvailability.status !== "OK") {
    gaps.push({ slug: null, item: "ga4CustomDimensions", reason: customDimensionAvailability.reason ?? customDimensionAvailability.status });
  } else {
    for (const [key, ok] of Object.entries(customDimensionAvailability.registered)) {
      if (!ok) gaps.push({ slug: null, item: `ga4CustomDimension:${key}`, reason: "CUSTOM_DIMENSION_NOT_REGISTERED" });
    }
  }
  return gaps;
}

/**
 * @param {{
 *   fromDate: string, toDate: string, runId: string,
 *   searchTrialConfigPath: string, docsDirPath: string,
 *   previousReport?: object|null,
 *   now?: () => Date,
 *   fetchers?: typeof defaultFetchers,
 * }} options
 */
export async function buildSearchTrialReport({
  fromDate,
  toDate,
  runId,
  searchTrialConfigPath,
  docsDirPath,
  previousReport = null,
  now = () => new Date(),
  fetchers = defaultFetchers,
}) {
  if (typeof runId !== "string" || !RUN_ID_RE.test(runId)) {
    throw new Error(`runIdが不正です(英数字・ハイフン・アンダースコアのみ使用できます): ${runId}`);
  }
  assertValidDate("--from", fromDate);
  assertValidDate("--to", toDate);
  if (toEpoch(fromDate) > toEpoch(toDate)) {
    throw new Error(`--fromが--toより後になっています(from=${fromDate}, to=${toDate})`);
  }

  const { pages: configPages } = await loadSearchTrialConfig(searchTrialConfigPath, docsDirPath);
  if (configPages.length === 0) {
    throw new Error("keyword-research/search-trial-pages.json に対象ページが1件もありません");
  }

  const trialStart = configPages.map((p) => p.startDate).sort()[0];
  const trialEnd = configPages.map((p) => p.reviewDate).sort().at(-1);
  if (toEpoch(fromDate) < toEpoch(trialStart) || toEpoch(toDate) > toEpoch(trialEnd)) {
    throw new Error(`対象期間(${fromDate}〜${toDate})が試験期間(${trialStart}〜${trialEnd})の範囲外です`);
  }

  const customDimensionAvailability = await fetchers.fetchGA4CustomDimensionAvailability();

  const pages = [];
  for (const page of configPages) {
    const pageUrl = pageUrlFor(page);
    const searchConsole = await fetchers.fetchSearchConsolePageMetrics({ pageUrl, startDate: fromDate, endDate: toDate });
    const urlInspection = await fetchers.fetchUrlInspectionStatus({ pageUrl });
    const ga4 = await fetchers.fetchGA4PageMetrics({ pageUrl, startDate: fromDate, endDate: toDate });
    const rakuten = await fetchers.fetchRakutenPerformance({ pageUrl, startDate: fromDate, endDate: toDate });
    const rakutenClickRate = computeRakutenClickRate(ga4);
    const judgment = judgeSearchTrialPage({ searchConsole, ga4, rakuten });

    pages.push({
      slug: page.slug,
      path: page.path,
      title: page.title,
      pageUrl,
      searchConsole,
      urlInspection,
      ga4,
      rakuten,
      rakutenClickRate,
      judgment,
    });
  }

  const diffFromPrevious = previousReport
    ? {
        previousRunId: previousReport.runId,
        pages: pages.map((p) => ({
          slug: p.slug,
          diff: buildDiffForPage(p, (previousReport.pages ?? []).find((pp) => pp.slug === p.slug)),
        })),
      }
    : null;

  const qaClickNoticeApplies = periodIncludesDate(fromDate, toDate, QA_VERIFICATION_DATE);

  return {
    runId,
    generatedAt: now().toISOString(),
    requestedPeriod: { from: fromDate, to: toDate },
    trialPeriod: { startDate: trialStart, reviewDate: trialEnd },
    qaClickNotice: qaClickNoticeApplies ? QA_VERIFICATION_NOTICE : null,
    customDimensionAvailability,
    pages,
    diffFromPrevious,
    dataGaps: collectDataGaps(pages, customDimensionAvailability),
  };
}
