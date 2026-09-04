// manual_csvアダプター: 手動CSV/エクスポートデータからKeywordObservationへ変換する。
// 想定ヘッダー: keyword,monthlySearches,competitionLevel,competitionIndex,lowTopOfPageBid,
//   highTopOfPageBid,impressions,clicks,ctr,averagePosition,trendIndex,country,language,rawReference
// 未取得値は空文字のまま(数値変換時にundefinedへ)。実績ゼロと欠損を区別する。

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
      keyword: r.keyword.trim(),
      observedAt,
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
