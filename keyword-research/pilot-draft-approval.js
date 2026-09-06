// Phase 3A(非公開下書きページ生成)専用の承認ファイル(approval.json)スキーマ検証。
// 2026-09-05監査で使われた既存approval.js(自然文キーワードの配列だけを持つ、
// keywords:export-approved用の別スキーマ)とは目的が異なるため、別モジュールにした。
// このスキーマは特定のsourceRun(candidateSetHash)に紐づいた、構造化された
// キーワード×title×slug×actionの配列を持つ。

import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

const MAX_KEYWORDS = 10;
const ALLOWED_ACTIONS = new Set(["CREATE"]);

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

  if (typeof raw.version !== "number") errors.push("versionが数値ではありません");
  if (typeof raw.sourceRunId !== "string" || raw.sourceRunId === "") errors.push("sourceRunIdが指定されていません");
  if (typeof raw.candidateSetHash !== "string" || raw.candidateSetHash === "") errors.push("candidateSetHashが指定されていません");
  if (raw.approvedBy !== "human") errors.push('approvedByは"human"である必要があります');
  if (typeof raw.approvedAt !== "string" || raw.approvedAt === "") errors.push("approvedAtが指定されていません");
  if (!Array.isArray(raw.keywords) || raw.keywords.length === 0) {
    errors.push("keywordsは1件以上の配列である必要があります");
  } else {
    if (raw.keywords.length > MAX_KEYWORDS) {
      errors.push(`keywordsは最大${MAX_KEYWORDS}件までです(指定: ${raw.keywords.length}件)`);
    }
    const seenSlugs = new Set();
    const seenKeywords = new Set();
    raw.keywords.forEach((k, i) => {
      if (typeof k.normalizedKeyword !== "string" || k.normalizedKeyword === "") {
        errors.push(`keywords[${i}].normalizedKeywordが指定されていません`);
      } else if (seenKeywords.has(k.normalizedKeyword)) {
        errors.push(`keywords[${i}].normalizedKeyword「${k.normalizedKeyword}」が承認ファイル内で重複しています`);
      } else {
        seenKeywords.add(k.normalizedKeyword);
      }
      if (typeof k.title !== "string" || k.title === "") errors.push(`keywords[${i}].titleが指定されていません`);
      if (typeof k.slug !== "string" || k.slug === "" || !/^[a-z0-9-]+$/.test(k.slug)) {
        errors.push(`keywords[${i}].slugが不正です(英小文字・数字・ハイフンのみ許可): "${k.slug}"`);
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
