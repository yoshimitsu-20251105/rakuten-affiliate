// manual_csvアダプター: 手動CSV/エクスポートデータからKeywordObservationへ変換する。
// 想定ヘッダー: keyword,monthlySearches,competitionLevel,competitionIndex,lowTopOfPageBid,
//   highTopOfPageBid,impressions,clicks,ctr,averagePosition,trendIndex,country,language,
//   periodStart,periodEnd,sourceProvider,isSynthetic,rawReference
// 未取得値は空文字のまま(数値変換時にundefinedへ)。実績ゼロと欠損を区別する。
//
// 【2026-09-04監査対応】sourceProvider(データの出所)とisSynthetic(推定値/テスト値か)を
// 追加した。この2つと取得期間(periodStart/periodEnd)が揃わない限り、
// 「manual_csvという入力形式である」というだけではWebKeywordScoreのbusinessValidatedは
// true にならない(scoring.js参照)。sourceProviderを指定しない行は「出所不明」として
// 扱われ、常にbusinessValidated=falseになる。

import { readFile } from "node:fs/promises";
import { parseCsvRecords } from "../csv.js";

/**
 * @param {string} filePath
 * @returns {Promise<import('./index.js').SourceResult>}
 */
export async function fetchFromManualCsv(filePath) {
  if (!filePath) {
    return {
      observations: [],
      meta: { source: "manual_csv", configured: false, fallbackUsed: false, note: "CSVパス未指定のためskip" },
    };
  }
  let text;
  try {
    text = await readFile(filePath, "utf-8");
  } catch (e) {
    return {
      observations: [],
      meta: { source: "manual_csv", configured: true, fallbackUsed: false, note: `CSV読込失敗: ${e.message}` },
    };
  }
  const records = parseCsvRecords(text);
  const observedAt = new Date().toISOString();
  const observations = records
    .filter((r) => (r.keyword ?? "").trim() !== "")
    .map((r) => ({
      source: "manual_csv",
      // 出所が明記されていない行は「不明」として扱う(businessValidatedは常にfalseになる)
      sourceProvider: r.sourceProvider || "unknown",
      isSynthetic: parseBoolean(r.isSynthetic),
      keyword: r.keyword.trim(),
      observedAt,
      periodStart: r.periodStart || undefined,
      periodEnd: r.periodEnd || undefined,
      country: r.country || undefined,
      language: r.language || undefined,
      monthlySearches: toNumberOrUndefined(r.monthlySearches),
      competitionLevel: r.competitionLevel || undefined,
      competitionIndex: toNumberOrUndefined(r.competitionIndex),
      lowTopOfPageBid: toNumberOrUndefined(r.lowTopOfPageBid),
      highTopOfPageBid: toNumberOrUndefined(r.highTopOfPageBid),
      impressions: toNumberOrUndefined(r.impressions),
      clicks: toNumberOrUndefined(r.clicks),
      ctr: toNumberOrUndefined(r.ctr),
      averagePosition: toNumberOrUndefined(r.averagePosition),
      trendIndex: toNumberOrUndefined(r.trendIndex),
      rawReference: r.rawReference || filePath,
    }));
  return {
    observations,
    meta: {
      source: "manual_csv",
      configured: true,
      fallbackUsed: false,
      note: `${filePath} から${observations.length}件を読み込み`,
    },
  };
}

function toNumberOrUndefined(v) {
  if (v === undefined || v === null || String(v).trim() === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

// 未指定(空欄)は「推定値/テストではないと明言されていない」という意味でfalse扱いにはせず、
// businessValidated側の判定はsourceProvider(出所不明かどうか)で既に厳しくブロックされる。
// ここではCSVの"true"/"false"文字列だけを厳密にbooleanへ変換する(それ以外は明示なしとしてfalse)。
function parseBoolean(v) {
  if (v === undefined || v === null) return false;
  return String(v).trim().toLowerCase() === "true";
}
