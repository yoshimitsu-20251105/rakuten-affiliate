// Phase 3B(公開前商品レビュー・収益化プレビュー)専用: 商品公開承認ファイルのスキーマ検証(2026-09-07対応)。
//
// キーワード承認ファイル(pilot-draft-approval.js、Phase 3A)とは目的が異なる別スキーマ。
// こちらは「どのキーワードを下書き化するか」ではなく「どの商品を、どの表示名で、
// 人間がitemCode単位で公開承認したか」を記録する。このファイルは自動生成しない
// (人間が作成する)。
//
// 【重要】このモジュールはファイル自身のスキーマ(構造・型・文字列安全性)だけを検証する。
// source run・レビュー資料との整合性(itemCodeの実在確認・hash一致・レビュー生成日時との
// 前後関係)は、呼び出し側(publication-preview-build.js)がsource run/review runを
// 読み込んだ上で確認する(pilot-draft-approval.js / pilot-draft-build.jsと同じ責務分離)。

import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { isValidIsoDate, containsControlCharacters } from "./text-validation.js";
import { classifySafety } from "./safety.js";
import { MEDICAL_TERMS, HEALTH_TERMS } from "./config.js";

const SUPPORTED_SCHEMA_VERSION = 1;
const FUTURE_TOLERANCE_MS = 5 * 60 * 1000;
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const MIN_PRODUCTS_PER_PAGE = 3;
export const MAX_PRODUCTS_PER_PAGE = 5;
const MAX_DISPLAY_NAME_LENGTH = 120;
const DEFAULT_SAFETY_CONFIG = { medicalTerms: MEDICAL_TERMS, healthTerms: HEALTH_TERMS };

function isNonEmptyString(v) {
  return typeof v === "string" && v.trim() !== "";
}

function isSafeDisplayText(text, safetyConfig) {
  const { safetyStatus } = classifySafety(text, safetyConfig);
  return safetyStatus === "SAFE";
}

/**
 * @param {string} filePath
 * @param {{ safetyConfig?: any }} [options]
 * @returns {Promise<{ valid: boolean, approval: any|null, approvedFileHash: string|null, errors: string[] }>}
 */
export async function loadPublicationApprovalFile(filePath, { safetyConfig = DEFAULT_SAFETY_CONFIG } = {}) {
  const errors = [];
  if (!filePath) {
    return { valid: false, approval: null, approvedFileHash: null, errors: ["--publication-approved-file が指定されていません"] };
  }

  let raw;
  let text;
  try {
    text = await readFile(filePath, "utf-8");
    raw = JSON.parse(text);
  } catch (e) {
    return { valid: false, approval: null, approvedFileHash: null, errors: [`商品公開承認ファイルの読込/パースに失敗: ${e.message}`] };
  }
  const approvedFileHash = createHash("sha256").update(text, "utf-8").digest("hex");

  if (raw.schemaVersion !== SUPPORTED_SCHEMA_VERSION) {
    errors.push(`schemaVersionは現在サポートする値(${SUPPORTED_SCHEMA_VERSION})のみ許可されます(指定値: ${JSON.stringify(raw.schemaVersion ?? null)})`);
  }
  if (!isNonEmptyString(raw.sourceRunId)) errors.push("sourceRunIdが指定されていません");
  if (!isNonEmptyString(raw.candidateSetHash)) errors.push("candidateSetHashが指定されていません");
  if (!isNonEmptyString(raw.keywordApprovedFileHash)) errors.push("keywordApprovedFileHashが指定されていません");
  if (!isNonEmptyString(raw.reviewRunId)) errors.push("reviewRunIdが指定されていません");
  if (!isNonEmptyString(raw.reviewedBy)) errors.push("reviewedByが指定されていません");
  else if (containsControlCharacters(raw.reviewedBy)) errors.push("reviewedByに制御文字が含まれています");

  if (!isValidIsoDate(raw.approvedAt)) {
    errors.push(`approvedAtが有効なISO日時ではありません(値: ${JSON.stringify(raw.approvedAt ?? null)})`);
  } else if (Date.parse(raw.approvedAt) > Date.now() + FUTURE_TOLERANCE_MS) {
    errors.push(`approvedAtが現在時刻より5分を超えて未来です(値: ${raw.approvedAt})`);
  }

  if (raw.humanApproved !== true) {
    errors.push("humanApprovedがtrueではありません(この承認ファイルはhumanApproved=trueの明示的な人間承認が必須です)");
  }

  if (!Array.isArray(raw.pages) || raw.pages.length === 0) {
    errors.push("pagesは1件以上の配列である必要があります");
  } else {
    const seenSlugs = new Set();
    raw.pages.forEach((page, pageIdx) => {
      const pagePrefix = `pages[${pageIdx}]`;

      if (!isNonEmptyString(page.normalizedKeyword)) errors.push(`${pagePrefix}.normalizedKeywordが指定されていません`);
      else if (containsControlCharacters(page.normalizedKeyword)) errors.push(`${pagePrefix}.normalizedKeywordに制御文字が含まれています`);

      if (typeof page.slug !== "string" || page.slug === "" || !SLUG_PATTERN.test(page.slug)) {
        errors.push(`${pagePrefix}.slugが不正です(英小文字・数字・ハイフンのみ、先頭・末尾・連続ハイフン不可): "${page.slug}"`);
      } else if (seenSlugs.has(page.slug)) {
        errors.push(`${pagePrefix}.slug「${page.slug}」が承認ファイル内で重複しています`);
      } else {
        seenSlugs.add(page.slug);
      }

      if (!isNonEmptyString(page.title)) errors.push(`${pagePrefix}.titleが指定されていません`);
      else if (containsControlCharacters(page.title)) errors.push(`${pagePrefix}.titleに制御文字が含まれています`);

      if (!Array.isArray(page.requiredAttributes) || page.requiredAttributes.length === 0) {
        errors.push(`${pagePrefix}.requiredAttributesは1件以上の配列である必要があります`);
      }

      if (!Array.isArray(page.products)) {
        errors.push(`${pagePrefix}.productsは配列である必要があります`);
        return;
      }
      if (page.products.length < MIN_PRODUCTS_PER_PAGE || page.products.length > MAX_PRODUCTS_PER_PAGE) {
        errors.push(
          `${pagePrefix}.productsは${MIN_PRODUCTS_PER_PAGE}〜${MAX_PRODUCTS_PER_PAGE}件である必要があります(指定: ${page.products.length}件)`
        );
      }

      const seenItemCodes = new Set();
      page.products.forEach((product, productIdx) => {
        const productPrefix = `${pagePrefix}.products[${productIdx}]`;

        if (!isNonEmptyString(product.itemCode)) {
          errors.push(`${productPrefix}.itemCodeが指定されていません`);
        } else if (seenItemCodes.has(product.itemCode)) {
          errors.push(`${productPrefix}.itemCode「${product.itemCode}」がページ内で重複しています`);
        } else {
          seenItemCodes.add(product.itemCode);
        }

        const rawDisplayName = typeof product.displayName === "string" ? product.displayName : "";
        const displayName = rawDisplayName.trim();
        if (displayName === "") {
          errors.push(`${productPrefix}.displayNameが指定されていません(またはtrim後に空文字です)`);
        } else if (displayName.length > MAX_DISPLAY_NAME_LENGTH) {
          errors.push(`${productPrefix}.displayNameが${MAX_DISPLAY_NAME_LENGTH}文字を超えています(実際: ${displayName.length}文字)`);
        } else if (containsControlCharacters(rawDisplayName)) {
          errors.push(`${productPrefix}.displayNameに制御文字が含まれています`);
        } else if (!isSafeDisplayText(displayName, safetyConfig)) {
          errors.push(`${productPrefix}.displayNameに医療・健康効果を断定する表現が含まれています`);
        }

        if (product.displayNote !== undefined && product.displayNote !== null) {
          const rawDisplayNote = typeof product.displayNote === "string" ? product.displayNote : "";
          if (containsControlCharacters(rawDisplayNote)) {
            errors.push(`${productPrefix}.displayNoteに制御文字が含まれています`);
          } else if (rawDisplayNote.trim() !== "" && !isSafeDisplayText(rawDisplayNote, safetyConfig)) {
            errors.push(`${productPrefix}.displayNoteに医療・健康効果を断定する表現が含まれています`);
          }
        }

        if (product.humanApproved !== true) {
          errors.push(`${productPrefix}.humanApprovedがtrueではありません(商品ごとに明示的な人間承認が必須です)`);
        }
      });
    });
  }

  if (errors.length > 0) {
    return { valid: false, approval: null, approvedFileHash, errors };
  }
  return { valid: true, approval: raw, approvedFileHash, errors: [] };
}
