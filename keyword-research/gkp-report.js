// GKP正式CLI専用の追加レポート出力(2026-09-06対応)。
// 既存のwriteReports()(keyword-scores.csv/rakuten-matches.csv/summary.md/
// run-metadata.json)はそのまま再利用し、GKP取込特有の追加ファイルだけをここで書く:
//   - converted-all.csv: 正規化前、変換直後の全行(犬猫結合済み)
//   - normalized-keywords.csv: 正規化・重複統合後の候補一覧(楽天照合前)
//   - selected-for-rakuten.csv: 楽天照合へ渡した候補(安全な選出条件を通過したもの)
//   - excluded-keywords.csv: 楽天照合へ渡さなかった候補と理由
//   - rakuten-items.json: ELIGIBLE商品の表示用フィールドのみ(2026-09-07 Phase 3A対応。
//     商品名・価格・レビュー・URL等の公開情報のみで、APIレスポンス全文ではない)

import { writeFile } from "node:fs/promises";
import { toCsv } from "./csv.js";

/**
 * @param {import('./types.js').KeywordObservation[]} observations - 変換直後(正規化前)の全観測
 * @param {string} outDir
 */
export async function writeConvertedAllCsv(observations, outDir) {
  const rows = observations.map((o) => ({
    originalKeyword: o.keyword,
    animalType: o.animalType ?? "",
    monthlySearches: o.monthlySearches ?? "",
    competitionLevel: o.competitionLevel ?? "",
    competitionIndex: o.competitionIndex ?? "",
    lowTopOfPageBid: o.lowTopOfPageBid ?? "",
    highTopOfPageBid: o.highTopOfPageBid ?? "",
    periodStart: o.periodStart ?? "",
    periodEnd: o.periodEnd ?? "",
    sourceProvider: o.sourceProvider ?? "",
    isSynthetic: o.isSynthetic ?? false,
    inputFileHash: o.inputFileHash ?? "",
    rawReference: o.rawReference ?? "",
  }));
  await writeFile(
    `${outDir}/converted-all.csv`,
    toCsv(Object.keys(rows[0] ?? { originalKeyword: "" }), rows),
    "utf-8"
  );
}

/**
 * @param {any[]} candidatesWithPreScore - attachPreScore()済みの正規化後候補(楽天照合前)
 * @param {string} outDir
 */
export async function writeNormalizedKeywordsCsv(candidatesWithPreScore, outDir) {
  const rows = candidatesWithPreScore.map((c) => ({
    originalKeyword: c.originalKeyword,
    normalizedKeyword: c.normalizedKeyword,
    keywordVariants: (c.keywordVariants ?? []).join(" | "),
    variantCount: c.variantCount,
    detectedAnimalType: c.detectedAnimalType,
    intent: c.intent,
    safetyStatus: c.safetyStatus,
    queryQualityStatus: c.queryQualityStatus,
    businessValidated: c.preScore.businessValidated,
    monthlySearches: c.observation.monthlySearches ?? "",
    searchVolumeVariance: c.observation.searchVolumeVariance ? JSON.stringify(c.observation.searchVolumeVariance) : "",
    cluster: c.cluster.clusterLabel ?? "",
    preScoreTotal: c.preScore.total,
  }));
  await writeFile(
    `${outDir}/normalized-keywords.csv`,
    toCsv(Object.keys(rows[0] ?? { originalKeyword: "" }), rows),
    "utf-8"
  );
}

/**
 * @param {any[]} selected - gkp-selection.jsのselectCandidatesForRakuten().selected
 * @param {string} outDir
 */
export async function writeSelectedForRakutenCsv(selected, outDir) {
  const rows = selected.map((c) => ({
    originalKeyword: c.originalKeyword,
    normalizedKeyword: c.normalizedKeyword,
    rakutenQuery: c.rakutenQuery ?? "",
    detectedAnimalType: c.detectedAnimalType,
    preScoreTotal: c.preScore.total,
  }));
  await writeFile(
    `${outDir}/selected-for-rakuten.csv`,
    toCsv(Object.keys(rows[0] ?? { originalKeyword: "" }), rows),
    "utf-8"
  );
}

/**
 * @param {Array<{candidate: any, reasons: string[]}>} excluded - selectCandidatesForRakuten().excluded
 * @param {string} outDir
 */
export async function writeExcludedKeywordsCsv(excluded, outDir) {
  const rows = excluded.map((e) => ({
    originalKeyword: e.candidate.originalKeyword,
    normalizedKeyword: e.candidate.normalizedKeyword,
    detectedAnimalType: e.candidate.detectedAnimalType,
    reasons: e.reasons.join(" / "),
  }));
  await writeFile(
    `${outDir}/excluded-keywords.csv`,
    toCsv(Object.keys(rows[0] ?? { originalKeyword: "" }), rows),
    "utf-8"
  );
}

/**
 * ELIGIBLE商品の表示用フィールドのみを、normalizedKeyword単位でJSONへ保存する
 * (2026-09-07 Phase 3A: 非公開下書きページ生成対応)。商品名・価格・レビュー・URL等の
 * 公開情報のみを保持し、APIレスポンス全文・内部フィールドは含めない。新規API呼び出しは
 * 発生しない(runMapRakuten実行時に既にメモリ上にある結果を書き出すだけ)。
 * @param {any[]} mappedCandidates - runMapRakuten()の戻り値(eligibleItemSummariesを含む)
 * @param {string} outDir
 */
export async function writeRakutenItemsJson(mappedCandidates, outDir) {
  const byKeyword = {};
  for (const c of mappedCandidates) {
    if (c.eligibleItemSummaries && c.eligibleItemSummaries.length > 0) {
      byKeyword[c.normalizedKeyword] = c.eligibleItemSummaries;
    }
  }
  await writeFile(`${outDir}/rakuten-items.json`, JSON.stringify(byKeyword, null, 2), "utf-8");
}
