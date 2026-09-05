// 承認ゲート。人間が編集する承認ファイル(JSON)を読み込み、公開候補を絞り込む。
// 承認ファイルの keywords は自然な表記で書いてよい(normalizeKeyword()と同じ正規化を
// 通してcanonicalKeywordへ変換し、パイプライン側のcanonicalKeywordと突き合わせる)。

import { readFile } from "node:fs/promises";
import { normalizeKeyword } from "./normalize.js";

/**
 * @typedef {Object} ApprovalFile
 * @property {string[]} keywords - 承認するキーワード(自然な表記でよい)
 * @property {string} [approvedBy]
 * @property {string} [approvedAt]
 * @property {string} [note]
 */

/**
 * @param {string} filePath
 * @param {{synonyms: Record<string,string[]>}} config
 * @returns {Promise<{ valid: boolean, canonicalApprovedSet: Set<string>, raw: ApprovalFile|null, errors: string[] }>}
 */
export async function loadApprovalFile(filePath, config) {
  const errors = [];
  if (!filePath) {
    return { valid: false, canonicalApprovedSet: new Set(), raw: null, errors: ["--approved-file が指定されていません"] };
  }
  let raw;
  try {
    const text = await readFile(filePath, "utf-8");
    raw = JSON.parse(text);
  } catch (e) {
    return { valid: false, canonicalApprovedSet: new Set(), raw: null, errors: [`承認ファイルの読込/パースに失敗: ${e.message}`] };
  }
  if (!Array.isArray(raw.keywords)) {
    errors.push("承認ファイルの形式が不正です: keywords は配列である必要があります");
    return { valid: false, canonicalApprovedSet: new Set(), raw, errors };
  }
  const canonicalApprovedSet = new Set(
    raw.keywords.map((kw) => normalizeKeyword(kw, config).canonicalKeyword)
  );
  return { valid: true, canonicalApprovedSet, raw, errors };
}

/**
 * 公開対象となるための必要条件(10章)をすべて満たすか判定する。
 *
 * 【2026-09-05監査対応】businessValidatedを最優先の承認ゲートとして強制する。
 * businessValidated=falseの候補は、承認ファイルに含まれていても、スコアが
 * どれだけ高くても、常にブロックする(理由コード: BUSINESS_DATA_NOT_VALIDATED)。
 * fixture/synthetic/推定値をこのゲートで人間の承認手続きに乗せないための最終防御線。
 *
 * 【2026-09-05 GKP実データ監査対応】安全ゲート(safetyStatus)・検索語品質
 * (queryQualityStatus)・楽天照合の実行結果(rakutenLookupStatus)も、
 * pipeline.js(decision.js)の判定結果を信頼せず、この承認ゲート自身でも
 * 独立に再チェックする(多層防御。将来pipeline側の実装が変わっても、
 * このゲートだけで安全側に倒れるようにするため)。
 *
 * @param {{ canonicalKeyword: string, matchStatus?: string, rakutenSupplyStatus?: string, scoreBand?: string,
 *   intent: string, hasQualityScore: boolean, businessValidated: boolean, safetyStatus?: string,
 *   queryQualityStatus?: string, rakutenLookupStatus?: string }} candidate
 * @param {Set<string>} canonicalApprovedSet
 */
export function isPublishEligible(candidate, canonicalApprovedSet) {
  const reasons = [];
  // 最優先チェック: businessValidatedが無ければ他の条件を満たしていても即ブロック
  if (!candidate.businessValidated) reasons.push("BUSINESS_DATA_NOT_VALIDATED");
  if (candidate.safetyStatus === "MEDICAL_REVIEW_REQUIRED") reasons.push("MEDICAL_REVIEW_REQUIRED");
  if (candidate.safetyStatus === "HEALTH_REVIEW_REQUIRED") reasons.push("HEALTH_REVIEW_REQUIRED");
  if (candidate.queryQualityStatus === "MALFORMED") reasons.push("MALFORMED_KEYWORD");
  if (candidate.queryQualityStatus === "REVIEW_REQUIRED") reasons.push("QUERY_REVIEW_REQUIRED");
  if (candidate.rakutenLookupStatus === "API_ERROR") reasons.push("RAKUTEN_LOOKUP_ERROR");
  if (candidate.rakutenLookupStatus === "NOT_RUN" && candidate.safetyStatus === "SAFE" && candidate.queryQualityStatus !== "MALFORMED") {
    reasons.push("INVALID_RAKUTEN_QUERY");
  }
  // 【2026-09-05 マージ前最終監査(2周目)対応】rakutenSupplyStatusが渡された場合は、
  // 楽天ELIGIBLE商品が最低基準(3件)以上あることを独立に再チェックする。
  // 旧matchStatusは`eligibleCount > 0 ? "ELIGIBLE" : "REJECTED"`という単純な判定で、
  // 1〜2件しかないINSUFFICIENT候補も"ELIGIBLE"として通過させてしまうバグがあったため、
  // rakutenSupplyStatus(ELIGIBLE/INSUFFICIENT/NO_MATCH/NOT_EVALUATED)を優先して見る。
  if (candidate.rakutenSupplyStatus !== undefined) {
    if (candidate.rakutenSupplyStatus === "NO_MATCH") reasons.push("SUPPLY_NO_MATCH");
    else if (candidate.rakutenSupplyStatus === "INSUFFICIENT") reasons.push("SUPPLY_INSUFFICIENT");
    else if (candidate.rakutenSupplyStatus !== "ELIGIBLE") reasons.push("SUPPLY_NOT_EVALUATED");
  } else if (candidate.matchStatus !== "ELIGIBLE") {
    reasons.push(`楽天商品照合結果が${candidate.matchStatus}のため不可`);
  }
  // scoreBandが渡された場合は、REJECT帯の候補が承認ファイルに誤って含まれていても
  // 独立に再ブロックする(多層防御)。
  if (candidate.scoreBand === "REJECT") reasons.push("SCORE_BAND_REJECT");
  if (!canonicalApprovedSet.has(candidate.canonicalKeyword)) reasons.push("未承認(承認ファイルに含まれない)");
  if (candidate.intent === "MEDICAL_REVIEW_REQUIRED") reasons.push("医療関連のため自動公開禁止");
  if (!candidate.hasQualityScore) reasons.push("Quality Score未計算");
  return { eligible: reasons.length === 0, reasons };
}
