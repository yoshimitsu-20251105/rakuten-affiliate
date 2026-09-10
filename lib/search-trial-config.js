// Phase 3B 検索公開試験ページ一覧(keyword-research/search-trial-pages.json)の
// 読込・検証(2026-09-10対応)。
//
// 【設計方針・fail closed】設定ファイルが存在しない場合だけは「試験ページなし」として
// 通常のサイト生成を継続してよい(既存サイト全体を止めないため)。それ以外の不正
// (JSON構文エラー・必須項目欠落・slug重複・参照先HTML不在・日付形式不正・
// reviewDateがstartDateより前・未知のstatus)は、黙って無視せずすべて例外を投げる。
// 呼び出し側(generate-site.js)はこれを捕捉し、docs/への書き込みを一切行わずに
// 非ゼロ終了すること(設定破損時に古い内容のまま静かにサイト生成を続けない)。

import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";

const ALLOWED_STATUS = ["search_trial"];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const REQUIRED_STRING_FIELDS = ["slug", "path", "title", "status", "startDate", "reviewDate", "pageType"];
const REQUIRED_BOOLEAN_FIELDS = ["sitemapEnabled", "internalLinkEnabled", "searchIndexEnabled"];

/**
 * @param {string} configPath - keyword-research/search-trial-pages.json への実パス
 * @param {string} docsDir - docs/ ディレクトリへの実パス(末尾スラッシュ付き)
 * @returns {Promise<{ pages: Array<{
 *   slug: string, path: string, title: string, status: string,
 *   startDate: string, reviewDate: string, pageType: string,
 *   sitemapEnabled: boolean, internalLinkEnabled: boolean, searchIndexEnabled: boolean,
 * }> }>}
 */
export async function loadSearchTrialConfig(configPath, docsDir) {
  let raw;
  try {
    raw = await readFile(configPath, "utf-8");
  } catch (e) {
    if (e.code === "ENOENT") {
      return { pages: [] };
    }
    throw new Error(`検索公開試験設定ファイルの読込に失敗しました: ${e.message}`);
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    throw new Error(`検索公開試験設定ファイル(${configPath})のJSONが不正です: ${e.message}`);
  }

  if (!Array.isArray(data.pages)) {
    throw new Error(`検索公開試験設定ファイル(${configPath})の "pages" が配列ではありません`);
  }

  const seenSlugs = new Set();
  const pages = [];

  for (let i = 0; i < data.pages.length; i++) {
    const page = data.pages[i];
    const where = `pages[${i}]`;

    if (page === null || typeof page !== "object") {
      throw new Error(`検索公開試験設定ファイル: ${where} がオブジェクトではありません`);
    }

    for (const field of REQUIRED_STRING_FIELDS) {
      if (typeof page[field] !== "string" || page[field].trim() === "") {
        throw new Error(`検索公開試験設定ファイル: ${where}.${field} が未設定または不正です`);
      }
    }
    for (const field of REQUIRED_BOOLEAN_FIELDS) {
      if (typeof page[field] !== "boolean") {
        throw new Error(`検索公開試験設定ファイル: ${where}.${field} はtrue/falseで指定してください`);
      }
    }

    if (seenSlugs.has(page.slug)) {
      throw new Error(`検索公開試験設定ファイル: slug「${page.slug}」が重複しています`);
    }
    seenSlugs.add(page.slug);

    if (!ALLOWED_STATUS.includes(page.status)) {
      throw new Error(`検索公開試験設定ファイル: ${where}.status「${page.status}」は未知の値です(許可: ${ALLOWED_STATUS.join(", ")})`);
    }

    if (!DATE_RE.test(page.startDate)) {
      throw new Error(`検索公開試験設定ファイル: ${where}.startDate「${page.startDate}」はYYYY-MM-DD形式で指定してください`);
    }
    if (!DATE_RE.test(page.reviewDate)) {
      throw new Error(`検索公開試験設定ファイル: ${where}.reviewDate「${page.reviewDate}」はYYYY-MM-DD形式で指定してください`);
    }
    if (Date.parse(`${page.reviewDate}T00:00:00Z`) < Date.parse(`${page.startDate}T00:00:00Z`)) {
      throw new Error(`検索公開試験設定ファイル: ${where}.reviewDate「${page.reviewDate}」がstartDate「${page.startDate}」より前です`);
    }

    const htmlPath = `${docsDir}${page.path}`;
    if (!existsSync(htmlPath)) {
      throw new Error(`検索公開試験設定ファイル: ${where}.path「${page.path}」が参照する docs/${page.path} が存在しません`);
    }

    pages.push({
      slug: page.slug,
      path: page.path,
      title: page.title,
      status: page.status,
      startDate: page.startDate,
      reviewDate: page.reviewDate,
      pageType: page.pageType,
      sitemapEnabled: page.sitemapEnabled,
      internalLinkEnabled: page.internalLinkEnabled,
      searchIndexEnabled: page.searchIndexEnabled,
    });
  }

  return { pages };
}
