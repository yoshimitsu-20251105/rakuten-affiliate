// Googleキーワードプランナー犬用・猫用CSVの取込〜正規化までの共通オーケストレーション
// (2026-09-06 正式CLI対応)。keywords:import-gkp と keywords:gkp-dry-run の両方が
// このモジュールを使う(ロジックの重複を避けるため)。
//
// 一回限りスクリプト(keyword-research/output/run-gkp-analysis.js)はこのモジュールを
// importしない(参考実装として残すのみ)。逆に、このモジュールが正式な実装になる。

import { loadConfig } from "./config.js";
import { runResearch } from "./pipeline.js";
import { resolveInputPath } from "./gkp-path-resolve.js";
import { parseGkpFile } from "./sources/gkp-google-planner.js";
import { attachPreScore } from "./gkp-selection.js";

/**
 * @param {{ dogCsvPath: string, catCsvPath: string, config?: any }} options
 */
export async function importAndNormalizeGkp(options) {
  if (!options.dogCsvPath || !options.catCsvPath) {
    throw new Error("--dog-csv と --cat-csv の両方を指定してください");
  }

  const dogPath = resolveInputPath(options.dogCsvPath);
  const catPath = resolveInputPath(options.catCsvPath);

  const [dog, cat] = await Promise.all([
    parseGkpFile(dogPath, { animalType: "dog" }),
    parseGkpFile(catPath, { animalType: "cat" }),
  ]);

  const observations = [...dog.observations, ...cat.observations];
  if (observations.length === 0) {
    throw new Error("犬用・猫用CSVのいずれにも有効なキーワード行がありません(CSVが空です)");
  }

  // 画面表示用: 入力ファイルの解析結果が確定した時点(重い正規化処理より前)で通知する
  if (typeof options.onFilesParsed === "function") {
    options.onFilesParsed({ dogPath, catPath, dogMeta: dog.meta, catMeta: cat.meta, originalRowCount: observations.length });
  }

  const config = options.config ?? (await loadConfig());
  const sourceMetas = [
    {
      source: "gkp_dog_csv",
      configured: true,
      fallbackUsed: false,
      note: `${dogPath} から${dog.observations.length}件を読み込み(encoding=${dog.meta.encoding}, delimiter=${dog.meta.delimiter}, period=${dog.meta.periodStart}〜${dog.meta.periodEnd})`,
    },
    {
      source: "gkp_cat_csv",
      configured: true,
      fallbackUsed: false,
      note: `${catPath} から${cat.observations.length}件を読み込み(encoding=${cat.meta.encoding}, delimiter=${cat.meta.delimiter}, period=${cat.meta.periodStart}〜${cat.meta.periodEnd})`,
    },
  ];

  const researchResult = await runResearch({ observations, sourceMetas, config });
  const candidatesWithPreScore = attachPreScore(researchResult.candidates, config);

  const periodStart = [dog.meta.periodStart, cat.meta.periodStart].sort()[0];
  const periodEnd = [dog.meta.periodEnd, cat.meta.periodEnd].sort().at(-1);

  return {
    observations,
    researchResult: { ...researchResult, candidates: candidatesWithPreScore },
    dogMeta: dog.meta,
    catMeta: cat.meta,
    inputFiles: [dogPath, catPath],
    inputFileHashes: { dog: dog.meta.inputFileHash, cat: cat.meta.inputFileHash },
    originalRowCount: observations.length,
    periodStart,
    periodEnd,
    periodMismatch: dog.meta.periodStart !== cat.meta.periodStart || dog.meta.periodEnd !== cat.meta.periodEnd,
  };
}
