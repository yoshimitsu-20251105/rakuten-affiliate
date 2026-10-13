// sitemap.xml の <lastmod> を「ページ内容が実際に変わった日」だけにするための補助関数。
// 日次生成のたびにページに埋め込まれる日付文字列(情報取得日・最終更新日)は
// 内容の変更とみなさず、それ以外のHTMLが変わった場合のみ lastmod を当日にする。
// 導入前から存在したURL(初回実行時点の旧sitemap.xmlに載っているURL)は、正確な過去の更新日が
// 分からないため lastmod を省略する。旧sitemapの lastmod 値は信用せず、引き継がない。
// 初回実行中に新しく生成されたURLと、以後に変更・追加されたURLは当日を lastmod にする。

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
 * @param {Set<string>} legacyPaths 初回(previous===null)のときだけ使う。導入前の旧sitemap.xmlに載っていたURLの相対パス
 * @returns {Record<string, { hash: string, lastmod: string | null }>}
 */
export function resolveLastmods(pages, previous, today, legacyPaths = new Set()) {
  const result = {};
  for (const { path, hash } of pages) {
    const prev = previous?.[path];
    let lastmod;
    if (previous === null) lastmod = legacyPaths.has(path) ? null : today;
    else if (!prev) lastmod = today;
    else lastmod = prev.hash === hash ? prev.lastmod : today;
    result[path] = { hash, lastmod };
  }
  return result;
}

/** sitemap.xml の <loc> だけを取り出し、SITE_URLからの相対パスの集合にする(<lastmod> は読まない)。 */
export function parseSitemapPaths(xml, siteUrl) {
  const prefix = `${siteUrl}/`;
  const paths = new Set();
  for (const m of xml.matchAll(/<loc>([^<]*)<\/loc>/g)) {
    if (m[1].startsWith(prefix)) paths.add(m[1].slice(prefix.length));
  }
  return paths;
}

/** 旧sitemap.xmlが存在しない場合は空の集合(=導入前のURLなし)。それ以外の読み込み失敗は例外を投げる。 */
export async function loadLegacySitemapPaths(fileUrl, siteUrl) {
  try {
    return parseSitemapPaths(await readFile(fileUrl, "utf-8"), siteUrl);
  } catch (e) {
    if (e.code === "ENOENT") return new Set();
    throw e;
  }
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
