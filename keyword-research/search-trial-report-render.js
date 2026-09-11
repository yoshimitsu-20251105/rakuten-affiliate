// Phase 3C(検索公開試験レポート)専用: report.md / report.json のレンダリング
// (2026-09-17対応)。事実(APIから取得した値)・計算値(このコードで算出した値)・
// 未取得(NOT_AVAILABLE等)・推定(このコードでは行わない。判定基準は「暫定基準」と
// 明記する)を区別して表示する。

function fmt(v) {
  if (v === null || v === undefined) return "―";
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : v.toFixed(2);
  return String(v);
}

function fmtPercent(v) {
  if (typeof v !== "number") return fmt(v);
  return `${v.toFixed(2)}%`;
}

function fmtDiff(v) {
  if (typeof v !== "number") return fmt(v);
  const sign = v > 0 ? "+" : "";
  return `${sign}${Number.isInteger(v) ? v : v.toFixed(2)}`;
}

const JUDGMENT_LABELS = {
  INSUFFICIENT_DATA: "データ不足(表示回数100未満またはPV20未満)",
  SEARCH_SNIPPET_REVIEW: "検索結果でのクリック率要確認(表示回数100以上・検索クリック0)",
  PAGE_CONVERSION_REVIEW: "ページ内導線要確認(PV20以上・CTAクリック0)",
  PRODUCT_OFFER_REVIEW: "商品訴求要確認(CTAクリック10件以上・楽天注文0件)",
  MONETIZATION_SIGNAL_DETECTED: "収益化シグナルあり(成果報酬1件以上)",
};

function renderSearchConsoleSection(page) {
  const sc = page.searchConsole;
  if (sc.status !== "OK") {
    return `- ステータス: 未取得(${sc.reason ?? sc.status})`;
  }
  const lines = [
    `- クリック数: ${fmt(sc.clicks)}件(事実)`,
    `- 表示回数: ${fmt(sc.impressions)}件(事実)`,
    `- CTR: ${fmtPercent(sc.ctr * 100)}(Search Console提供値)`,
    `- 平均掲載順位: ${fmt(sc.averagePosition)}(事実)`,
    `- データ取得可能な最終日: ${sc.dataLastAvailableDate}`,
  ];
  if (sc.topQueries?.length) {
    lines.push("- 上位検索クエリ:");
    for (const q of sc.topQueries.slice(0, 10)) {
      lines.push(`  - "${q.query}": クリック${fmt(q.clicks)} / 表示${fmt(q.impressions)} / 掲載順位${fmt(q.averagePosition)}`);
    }
  }
  if (sc.byDevice?.length) {
    lines.push(`- device別: ${sc.byDevice.map((d) => `${d.device}(クリック${fmt(d.clicks)}/表示${fmt(d.impressions)})`).join(", ")}`);
  }
  if (sc.byCountry?.length) {
    lines.push(`- country別: ${sc.byCountry.map((c) => `${c.country}(クリック${fmt(c.clicks)}/表示${fmt(c.impressions)})`).join(", ")}`);
  }
  return lines.join("\n");
}

function renderGa4Section(page) {
  const ga4 = page.ga4;
  if (ga4.status !== "OK") {
    return `- ステータス: 未取得(${ga4.reason ?? ga4.status})`;
  }
  return [
    `- activeUsers: ${fmt(ga4.activeUsers)}(事実)`,
    `- sessions: ${fmt(ga4.sessions)}(事実)`,
    `- screenPageViews: ${fmt(ga4.screenPageViews)}(事実)`,
    `- engagementRate: ${fmtPercent(ga4.engagementRate * 100)}(GA4提供値)`,
    `- averageSessionDuration: ${fmt(ga4.averageSessionDuration)}秒(事実)`,
    `- affiliate_click eventCount: ${fmt(ga4.affiliateClickEventCount)}件(事実)`,
  ].join("\n");
}

function renderRakutenClickRate(page) {
  if (page.rakutenClickRate === "NOT_CALCULABLE") return "NOT_CALCULABLE(screenPageViewsが0のため計算不能)";
  if (page.rakutenClickRate === "NOT_AVAILABLE") return "未取得(GA4データが取得できないため計算不能)";
  return `${fmtPercent(page.rakutenClickRate)}(計算値: affiliate_click eventCount ÷ screenPageViews × 100)`;
}

function renderRakutenSection(page) {
  return [
    "- 楽天成果データ: **NOT_CONNECTED(未取得)**。既存リポジトリに楽天注文・成果報酬を安全に取得する仕組みが無いため、0件と表示せず未取得として扱っています。",
    `  - 注文件数: ${page.rakuten.orders}`,
    `  - 売上金額: ${page.rakuten.revenue}`,
    `  - 成果報酬: ${page.rakuten.commission}`,
    `  - 成約率: ${page.rakuten.conversionRate}`,
  ].join("\n");
}

function renderDiffForPage(diffEntry) {
  if (!diffEntry || !diffEntry.diff) return "(前回レポートなし、または前回レポートに同一ページが存在しません)";
  const d = diffEntry.diff;
  return [
    `- Search Console クリック数: ${fmtDiff(d.searchConsole.clicks)}`,
    `- Search Console 表示回数: ${fmtDiff(d.searchConsole.impressions)}`,
    `- GA4 screenPageViews: ${fmtDiff(d.ga4.screenPageViews)}`,
    `- GA4 affiliate_click: ${fmtDiff(d.ga4.affiliateClickEventCount)}`,
    `- 楽天クリック率: ${fmtDiff(d.rakutenClickRate)}`,
  ].join("\n");
}

export function renderReportMarkdown(report) {
  const lines = [];
  lines.push(`# 検索公開試験レポート(${report.runId})`);
  lines.push("");
  lines.push("> 以下の判定基準(INSUFFICIENT_DATA等)は業界標準ではなく、今回の検索公開試験用に定めた暫定基準です。");
  if (report.qaClickNotice) {
    lines.push("");
    lines.push(`> ⚠ ${report.qaClickNotice}`);
  }
  lines.push("");
  lines.push("## 1. 対象期間");
  lines.push(`- 集計対象: ${report.requestedPeriod.from} 〜 ${report.requestedPeriod.to}`);
  lines.push(`- 試験期間全体: ${report.trialPeriod.startDate} 〜 ${report.trialPeriod.reviewDate}`);
  lines.push("");
  lines.push("## 2. データ取得日時");
  lines.push(`- ${report.generatedAt}`);
  lines.push("");

  for (const page of report.pages) {
    lines.push(`## ${page.title}(${page.slug})`);
    lines.push("");
    lines.push("### 3. データ取得可能な最終日");
    lines.push(`- Search Console: ${page.searchConsole.status === "OK" ? page.searchConsole.dataLastAvailableDate : "未取得"}`);
    lines.push("");
    lines.push("### 4. Search Console実績");
    lines.push(renderSearchConsoleSection(page));
    lines.push("");
    lines.push("### URLインデックス状況");
    lines.push(page.urlInspection.status === "OK" ? `- ${page.urlInspection.indexStatus}` : `- ${page.urlInspection.status}(${page.urlInspection.reason ?? "理由不明"})`);
    lines.push("");
    lines.push("### 5. GA4実績");
    lines.push(renderGa4Section(page));
    lines.push("");
    lines.push("### 6. 楽天CTAクリック率");
    lines.push(`- ${renderRakutenClickRate(page)}`);
    lines.push("");
    lines.push("### 7. 楽天成果データの取得可否");
    lines.push(renderRakutenSection(page));
    lines.push("");
    lines.push("### 8. 前回レポートとの増減");
    lines.push(renderDiffForPage(report.diffFromPrevious?.pages.find((p) => p.slug === page.slug)));
    lines.push("");
    lines.push("### 10. 暫定評価(このページ)");
    if (page.judgment.length === 0) {
      lines.push("- 該当する暫定基準なし");
    } else {
      for (const f of page.judgment) {
        lines.push(`- **${JUDGMENT_LABELS[f.status] ?? f.status}**(根拠: ${JSON.stringify(f.evidence)})`);
      }
    }
    lines.push("");
  }

  lines.push("## GA4カスタムディメンション(affiliate_clickの内訳)の利用可否");
  if (report.customDimensionAvailability.status !== "OK") {
    lines.push(`- 未取得(${report.customDimensionAvailability.reason ?? report.customDimensionAvailability.status})`);
  } else {
    for (const [key, ok] of Object.entries(report.customDimensionAvailability.registered)) {
      lines.push(`- ${key}: ${ok ? "取得可能" : "CUSTOM_DIMENSION_NOT_REGISTERED(GA4管理画面での登録が必要、本レポートでは新規登録していません)"}`);
    }
  }
  lines.push("");

  lines.push("## 9. データ不足・取得不能項目");
  if (report.dataGaps.length === 0) {
    lines.push("- なし");
  } else {
    for (const gap of report.dataGaps) {
      lines.push(`- ${gap.slug ?? "(全体)"}: ${gap.item} — ${gap.reason}`);
    }
  }
  lines.push("");

  lines.push("## 11. 次回確認日");
  lines.push(`- ${report.trialPeriod.reviewDate}(search-trial-pages.jsonのreviewDate。手動管理)`);
  lines.push("");

  return lines.join("\n");
}

export function renderReportJson(report) {
  return JSON.stringify(report, null, 2);
}
