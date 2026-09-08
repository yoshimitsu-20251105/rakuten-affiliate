// SHA-256ハッシュ計算の共通ユーティリティ(2026-09-07 PR#5監査対応)。
// candidateSetHashの算出は、生成側(report.js)と検証側(pilot-draft-source-run.js)で
// 同一のアルゴリズムを使う必要があるため、二重実装を避けてここへ集約した。

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

/**
 * @param {string} text
 * @returns {string}
 */
export function sha256Text(text) {
  return createHash("sha256").update(text, "utf-8").digest("hex");
}

/**
 * @param {string} filePath
 * @returns {Promise<string>}
 */
export async function sha256File(filePath) {
  const buf = await readFile(filePath);
  return createHash("sha256").update(buf).digest("hex");
}

/**
 * candidateSetHash: 候補集合(originalKeywordの集合)を一意に識別するハッシュ。
 * 【重要】このアルゴリズムを変更する場合は、生成側(report.js)・検証側
 * (pilot-draft-source-run.js)の両方が必ず同じ結果になることを確認すること。
 * @param {Array<{ originalKeyword: string }>} candidates
 * @returns {string}
 */
export function computeCandidateSetHash(candidates) {
  return sha256Text(candidates.map((c) => c.originalKeyword).sort().join("\n"));
}

/**
 * publicationReviewHash(2026-09-07 Phase 3B対応): keywords:prepare-publication-reviewが
 * 提示した「人間が承認を検討できる候補」の集合(ページ×itemCode)を一意に識別するハッシュ。
 * 商品公開承認ファイルが参照しているreview結果と、実際にビルド時点で再計算した結果が
 * 一致することを検証するために使う(生成側・検証側で同じアルゴリズムを使うこと)。
 * @param {Array<{ slug: string, topCandidates: Array<{ itemCode: string }> }>} pages
 * @returns {string}
 */
export function computePublicationReviewHash(pages) {
  const lines = pages.flatMap((p) => p.topCandidates.map((c) => `${p.slug}:${c.itemCode}`)).sort();
  return sha256Text(lines.join("\n"));
}
