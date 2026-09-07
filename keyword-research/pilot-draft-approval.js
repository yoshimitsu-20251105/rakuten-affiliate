// Phase 3A(非公開下書きページ生成)専用の承認ファイル(approval.json)スキーマ検証。
// 2026-09-05監査で使われた既存approval.js(自然文キーワードの配列だけを持つ、
// keywords:export-approved用の別スキーマ)とは目的が異なるため、別モジュールにした。
// このスキーマは特定のsourceRun(candidateSetHash)に紐づいた、構造化された
// キーワード×title×slug×actionの配列を持つ。
//
// 【2026-09-07 PR#5監査対応】version=1固定・approvedAtの有効なISO日時+未来日時拒否・
// slug正規表現の厳格化(先頭・末尾・連続ハイフン拒否)・normalizedKeyword/titleの
// trim後空文字/制御文字チェックを追加した。制御文字判定は正規表現リテラルで
// 書かず(過去にnormalize.jsでエスケープ表記が実際の制御バイトへ変換され、ファイルが
// 破損する事故があったため)、文字コードの比較だけで実装する。

import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

const MAX_KEYWORDS = 10;
const ALLOWED_ACTIONS = new Set(["CREATE"]);
const SUPPORTED_VERSION = 1;
const FUTURE_TOLERANCE_MS = 5 * 60 * 1000; // approvedAtが現在時刻より5分を超えて未来なら拒否
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/; // 先頭・末尾・連続ハイフンを拒否

function isValidIsoDate(value) {
  return typeof value === "string" && value !== "" && Number.isFinite(Date.parse(value));
}

// 制御文字(コードポイント0-31、および127)を含むかどうかを文字コードの比較で判定する。
function containsControlCharacters(s) {
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (code <= 31 || code === 127) return true;
  }
  return false;
}

/**
 * @param {string} filePath
 * @returns {Promise<{ valid: boolean, approval: any|null, approvedFileHash: string|null, errors: string[] }>}
 */
export async function loadApprovalFile(filePath) {
  const errors = [];
  if (!filePath) {
    return { valid: false, approval: null, approvedFileHash: null, errors: ["--approved-file が指定されていません"] };
  }

  let raw;
  let text;
  try {
    text = await readFile(filePath, "utf-8");
    raw = JSON.parse(text);
  } catch (e) {
    return { valid: false, approval: null, approvedFileHash: null, errors: [`承認ファイルの読込/パースに失敗: ${e.message}`] };
  }
  const approvedFileHash = createHash("sha256").update(text, "utf-8").digest("hex");

  if (raw.version !== SUPPORTED_VERSION) {
    errors.push(`versionは現在サポートする値(${SUPPORTED_VERSION})のみ許可されます(指定値: ${JSON.stringify(raw.version ?? null)})`);
  }
  if (typeof raw.sourceRunId !== "string" || raw.sourceRunId === "") errors.push("sourceRunIdが指定されていません");
  if (typeof raw.candidateSetHash !== "string" || raw.candidateSetHash === "") errors.push("candidateSetHashが指定されていません");
  if (raw.approvedBy !== "human") errors.push('approvedByは"human"である必要があります');

  if (!isValidIsoDate(raw.approvedAt)) {
    errors.push(`approvedAtが有効なISO日時ではありません(値: ${JSON.stringify(raw.approvedAt ?? null)})`);
  } else if (Date.parse(raw.approvedAt) > Date.now() + FUTURE_TOLERANCE_MS) {
    errors.push(`approvedAtが現在時刻より5分を超えて未来です(値: ${raw.approvedAt})`);
  }

  if (!Array.isArray(raw.keywords) || raw.keywords.length === 0) {
    errors.push("keywordsは1件以上の配列である必要があります");
  } else {
    if (raw.keywords.length > MAX_KEYWORDS) {
      errors.push(`keywordsは最大${MAX_KEYWORDS}件までです(指定: ${raw.keywords.length}件)`);
    }
    const seenSlugs = new Set();
    const seenKeywords = new Set();
    raw.keywords.forEach((k, i) => {
      const rawNormalizedKeyword = typeof k.normalizedKeyword === "string" ? k.normalizedKeyword : "";
      const rawTitle = typeof k.title === "string" ? k.title : "";
      const normalizedKeyword = rawNormalizedKeyword.trim();
      const title = rawTitle.trim();

      if (normalizedKeyword === "") {
        errors.push(`keywords[${i}].normalizedKeywordが指定されていません(またはtrim後に空文字です)`);
      } else if (containsControlCharacters(rawNormalizedKeyword)) {
        errors.push(`keywords[${i}].normalizedKeywordに制御文字が含まれています`);
      } else if (seenKeywords.has(normalizedKeyword)) {
        errors.push(`keywords[${i}].normalizedKeyword「${normalizedKeyword}」が承認ファイル内で重複しています`);
      } else {
        seenKeywords.add(normalizedKeyword);
      }

      if (title === "") {
        errors.push(`keywords[${i}].titleが指定されていません(またはtrim後に空文字です)`);
      } else if (containsControlCharacters(rawTitle)) {
        errors.push(`keywords[${i}].titleに制御文字が含まれています`);
      }

      if (typeof k.slug !== "string" || k.slug === "" || !SLUG_PATTERN.test(k.slug)) {
        errors.push(
          `keywords[${i}].slugが不正です(英小文字・数字・ハイフンのみ、先頭・末尾・連続ハイフン不可): "${k.slug}"`
        );
      } else if (seenSlugs.has(k.slug)) {
        errors.push(`keywords[${i}].slug「${k.slug}」が承認ファイル内で重複しています`);
      } else {
        seenSlugs.add(k.slug);
      }
      if (!ALLOWED_ACTIONS.has(k.action)) {
        errors.push(`keywords[${i}].actionは"CREATE"のみ対応です(指定値: ${JSON.stringify(k.action ?? null)})`);
      }
    });
  }

  if (errors.length > 0) {
    return { valid: false, approval: null, approvedFileHash, errors };
  }
  return { valid: true, approval: raw, approvedFileHash, errors: [] };
}
