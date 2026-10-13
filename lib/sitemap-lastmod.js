// sitemap.xml の <lastmod> を「ページ内容が実際に変わった日」だけにするための補助関数。
// 日次生成のたびにページに埋め込まれる日付文字列(情報取得日・最終更新日)は
// 内容の変更とみなさず、それ以外のHTMLが変わった場合のみ lastmod を当日にする。
// 履歴が分からないURL(初回実行時)は、誤った日付を出すより lastmod を省略する。

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const DATE_STAMP_RE = /(情報取得日|最終更新日): ?\d{4}年\d{1,2}月\d{1,2}日/g;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function contentHash(html) {
  return createHash("sha256").update(html.replace(DATE_STAMP_RE, "$1:")).digest("hex");
}

/**
 * @param {{ path: string, hash: string }[]} pages path は SITE_URL からの相対パス
 * @param {Record<string, { hash: string, lastmod: string | null }> | null} previous 前回の記録。初回は null
 * @param {string} today YYYY-MM-DD
 * @returns {Record<string, { hash: string, lastmod: string | null }>}
 */
export function resolveLastmods(pages, previous, today) {
  const result = {};
  for (const { path, hash } of pages) {
    const prev = previous?.[path];
    let lastmod;
    if (previous === null) lastmod = null;
    else if (!prev) lastmod = today;
    else lastmod = prev.hash === hash ? prev.lastmod : today;
    result[path] = { hash, lastmod };
  }
  return result;
}

/** ファイルが存在しない場合は null(初回実行)。内容が不正な場合は例外を投げる。 */
export async function loadLastmodManifest(fileUrl) {
  let raw;
  try {
    raw = await readFile(fileUrl, "utf-8");
  } catch (e) {
    if (e.code === "ENOENT") return null;
    throw e;
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    throw new Error(`sitemap-lastmod.json のJSONが不正です: ${e.message}`);
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("sitemap-lastmod.json はオブジェクトである必要があります");
  }
  for (const [path, entry] of Object.entries(data)) {
    const validLastmod = entry?.lastmod === null || (typeof entry?.lastmod === "string" && ISO_DATE_RE.test(entry.lastmod));
    if (typeof entry?.hash !== "string" || !validLastmod) {
      throw new Error(`sitemap-lastmod.json の「${path}」の形式が不正です(hash は文字列、lastmod は YYYY-MM-DD または null)`);
    }
  }
  return data;
}
