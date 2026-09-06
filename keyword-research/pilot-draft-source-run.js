// Phase 3A(非公開下書きページ生成)専用: 保存済みのkeywords:gkp-dry-run実行結果
// (source run)を読み取り専用で読み込み、run単位のゲート検証と候補データの結合を行う。
// このモジュール自身は楽天/Google/Search Console APIを一切呼び出さない
// (既に保存済みのCSV/JSONファイルを読むだけ)。

import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { parseCsvRecords } from "./csv.js";

/**
 * source runのrun-metadata.jsonを検証する。
 * @param {any} metadata
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateSourceRunMetadata(metadata) {
  const errors = [];
  if (metadata.status !== "completed") {
    errors.push(`source runのstatusが"completed"ではありません(値: ${JSON.stringify(metadata.status ?? null)}。statusフィールドが無い旧runは拒否します)`);
  }
  if (metadata.rakutenSource !== "live") {
    errors.push(`source runのrakutenSourceが"live"ではありません(値: ${JSON.stringify(metadata.rakutenSource ?? null)})`);
  }
  const searchSourceCounts = metadata.searchSourceCounts ?? {};
  if (Object.prototype.hasOwnProperty.call(searchSourceCounts, "fixture")) {
    errors.push("source runのsearchSourceCountsにfixtureが含まれています(live専用runではありません)");
  }
  const apiErrorCount = metadata.resultCounts?.apiErrorCount;
  if (typeof apiErrorCount !== "number" || apiErrorCount !== 0) {
    errors.push(`source runのresultCounts.apiErrorCountが0ではありません(値: ${JSON.stringify(apiErrorCount ?? null)})`);
  }
  if (typeof metadata.candidateSetHash !== "string" || metadata.candidateSetHash === "") {
    errors.push("source runにcandidateSetHashが記録されていません");
  }
  return { valid: errors.length === 0, errors };
}

/**
 * source runディレクトリを読み込み、run-metadata検証 + 候補データの結合を行う。
 * @param {string} runDir - keywords:gkp-dry-runの出力ディレクトリ(実在確認済み)
 * @returns {Promise<{ valid: boolean, errors: string[], metadata: any|null, candidatesByKeyword: Map<string, any>|null }>}
 */
export async function loadSourceRun(runDir) {
  if (!existsSync(runDir)) {
    return { valid: false, errors: [`source runディレクトリが見つかりません: ${runDir}`], metadata: null, candidatesByKeyword: null };
  }

  let metadata;
  try {
    metadata = JSON.parse(await readFile(`${runDir}/run-metadata.json`, "utf-8"));
  } catch (e) {
    return { valid: false, errors: [`run-metadata.jsonの読込に失敗: ${e.message}`], metadata: null, candidatesByKeyword: null };
  }

  const { valid: metaValid, errors: metaErrors } = validateSourceRunMetadata(metadata);
  if (!metaValid) {
    return { valid: false, errors: metaErrors, metadata, candidatesByKeyword: null };
  }

  let scores, candidates, rakutenItemsByKeyword;
  try {
    scores = parseCsvRecords(await readFile(`${runDir}/keyword-scores.csv`, "utf-8"));
    candidates = parseCsvRecords(await readFile(`${runDir}/keyword-candidates.csv`, "utf-8"));
    rakutenItemsByKeyword = JSON.parse(await readFile(`${runDir}/rakuten-items.json`, "utf-8").catch(() => "{}"));
  } catch (e) {
    return { valid: false, errors: [`source runの候補データ読込に失敗: ${e.message}`], metadata, candidatesByKeyword: null };
  }

  let matchesByKeyword = new Map();
  try {
    const matches = parseCsvRecords(await readFile(`${runDir}/rakuten-matches.csv`, "utf-8"));
    for (const m of matches) {
      if (!matchesByKeyword.has(m.normalizedKeyword)) matchesByKeyword.set(m.normalizedKeyword, []);
      matchesByKeyword.get(m.normalizedKeyword).push(m);
    }
  } catch {
    // rakuten-matches.csvが空(候補0件)の場合、パースが失敗することがあるが致命的ではない
  }

  const candidatesByKeyword = new Map();
  for (const s of scores) {
    const c = candidates.find((x) => x.normalizedKeyword === s.normalizedKeyword) ?? {};
    const matches = matchesByKeyword.get(s.normalizedKeyword) ?? [];
    const eligibleMatches = matches.filter((m) => m.status === "ELIGIBLE");
    const eligibleItemCount = eligibleMatches.length;
    // ELIGIBLE商品は定義上、必須属性がすべて商品データで確認済み(missingAttributes=[])
    // なので、matchedAttributesは実質requiredAttributesと同一。下書きの「確認できた属性」
    // 表示にはこれを使う(商品データに無い属性を新たに推定することはしない)。
    const matchedAttributes = eligibleMatches[0]
      ? (eligibleMatches[0].matchedAttributes ?? "").split(" | ").filter(Boolean)
      : [];
    candidatesByKeyword.set(s.normalizedKeyword, {
      matchedAttributes,
      originalKeyword: s.originalKeyword,
      normalizedKeyword: s.normalizedKeyword,
      businessValidated: s.businessValidated === "true",
      decisionStatus: s.decisionStatus,
      scoreBand: s.scoreBand_simulationOnly,
      eligibleForApproval: s.eligibleForApproval === "true",
      safetyStatus: s.safetyStatus,
      queryQualityStatus: s.queryQualityStatus,
      rakutenLookupStatus: s.rakutenLookupStatus,
      rakutenSupplyStatus: s.rakutenSupplyStatus,
      finalPriority: Number(s.finalPriority),
      webKeywordScoreTotal: Number(s.webKeywordScoreTotal),
      bestProductQualityScore: Number(s.bestProductQualityScore),
      cluster: c.cluster ?? "",
      monthlySearches: c.monthlySearches ?? "",
      competitionLevel: c.competitionLevel ?? "",
      eligibleItemCount,
      eligibleItems: rakutenItemsByKeyword[s.normalizedKeyword] ?? [],
    });
  }

  return { valid: true, errors: [], metadata, candidatesByKeyword };
}
