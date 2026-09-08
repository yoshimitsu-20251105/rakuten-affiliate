// keyword-research/output/配下の各種run(gkp-runs / publication-reviews /
// publication-enrichment / publication-previews等)は、すべて同じoutputディレクトリの
// 直下に並ぶ運用のため、あるrunのディレクトリパスから兄弟runの場所を機械的に
// 導出できる(2026-09-07 Phase 3B対応)。

/**
 * 任意のrunディレクトリパス(例: ".../keyword-research/output/gkp-runs/<runId>/")から、
 * その親であるoutputディレクトリ(".../keyword-research/output/")を導出する。
 * @param {string} anyRunDirPath
 * @returns {string} 末尾に区切り文字を含むoutputディレクトリパス
 */
export function deriveOutputRoot(anyRunDirPath) {
  const normalized = String(anyRunDirPath).replace(/[\\/]+$/, "");
  const parts = normalized.split(/[\\/]/);
  const idx = parts.lastIndexOf("output");
  if (idx === -1) {
    throw new Error(`outputディレクトリを特定できません(想定外のパス構造です): ${anyRunDirPath}`);
  }
  return parts.slice(0, idx + 1).join("/") + "/";
}
