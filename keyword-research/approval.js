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
 * @param {{ canonicalKeyword: string, matchStatus: string, intent: string, hasQualityScore: boolean, businessValidated: boolean }} candidate
 * @param {Set<string>} canonicalApprovedSet
 */
export function isPublishEligible(candidate, canonicalApprovedSet) {
  const reasons = [];
  // 最優先チェック: businessValidatedが無ければ他の条件を満たしていても即ブロック
  if (!candidate.businessValidated) reasons.push("BUSINESS_DATA_NOT_VALIDATED");
  if (!canonicalApprovedSet.has(candidate.canonicalKeyword)) reasons.push("未承認(承認ファイルに含まれない)");
  if (candidate.intent === "MEDICAL_REVIEW_REQUIRED") reasons.push("医療関連のため自動公開禁止");
  if (candidate.matchStatus !== "ELIGIBLE") reasons.push(`楽天商品照合結果が${candidate.matchStatus}のため不可`);
  if (!candidate.hasQualityScore) reasons.push("Quality Score未計算");
  return { eligible: reasons.length === 0, reasons };
}
