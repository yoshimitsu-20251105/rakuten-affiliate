// Daily read-only monitoring helpers; registration and strategy changes remain separate.
export function measurementPeriod(pages, now = new Date()) {
  if (!pages.length) throw new Error("No measurement targets");
  const today = new Date(now.getTime() + 9 * 3600000).toISOString().slice(0, 10);
  const delayed = new Date(Date.parse(`${today}T00:00:00Z`) - 3 * 86400000).toISOString().slice(0, 10);
  const from = pages.map(p => p.startDate).sort()[0];
  const lastReview = pages.map(p => p.reviewDate).sort().at(-1);
  if (delayed > lastReview) throw new Error("Measurement period ended: review experiments before continuing");
  if (delayed < from) throw new Error("No complete observation window yet");
  return { from, to: delayed };
}

export function measurementSummary(report) {
  const lines = [
    "## 日次の登録・収益導線監視",
    `計測要求期間: ${report.requestedPeriod.from}〜${report.requestedPeriod.to}`,
    "3日前までを要求。遅延回避の余裕であり、全データの確定を保証しない。登録状況は取得時点。",
    "売上・確定報酬は楽天データ接続までUNKNOWN。0円として扱わない。自動SCALE/KILLは行わない。",
    "",
    "| ページ | 登録状況 | 表示 | 検索クリック | 閲覧 | 楽天クリックイベント |",
    "|---|---|---:|---:|---:|---:|",
  ];
  let unavailable = 0;
  let notIndexed = 0;
  const value = (data, key) => data?.status === "OK" && Number.isFinite(data[key]) ? data[key] : "UNKNOWN";
  for (const p of report.pages) {
    const available = p.urlInspection?.status === "OK";
    const indexed = available && p.urlInspection.indexStatus === "PASS";
    if (!available || p.searchConsole?.status !== "OK" || p.ga4?.status !== "OK") unavailable++;
    if (available && !indexed) notIndexed++;
    const state = available ? (indexed ? "登録済み" : "登録未確認・要調査") : "UNKNOWN";
    lines.push(`| ${p.slug} | ${state} | ${value(p.searchConsole, "impressions")} | ${value(p.searchConsole, "clicks")} | ${value(p.ga4, "screenPageViews")} | ${value(p.ga4, "affiliateClickEventCount")} |`);
  }
  lines.push("", `要調査: 登録未確認${notIndexed}件 / 計測取得不能${unavailable}ページ`,
    "楽天クリックはイベント件数であり、購入者数やユニーククリック数ではない。",
    "詳しいURL Inspection・計測値・欠損理由はreport.json/report.mdを確認する。");
  return { markdown: lines.join("\n"), unavailable, notIndexed };
}
