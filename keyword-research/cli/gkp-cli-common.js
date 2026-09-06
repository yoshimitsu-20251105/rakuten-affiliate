// keywords:import-gkp / keywords:gkp-dry-run の共通処理(2026-09-06 PR#4監査対応)。
// 両CLIで重複していたrunId生成・出力先の排他作成・失敗時メタデータ書き込みを集約する。

import { mkdir, writeFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { execSync } from "node:child_process";

export function getCodeCommit(cwdUrl) {
  try {
    return execSync("git rev-parse HEAD", { cwd: cwdUrl, encoding: "utf-8" }).trim();
  } catch {
    return null;
  }
}

export function sanitizeRunId(id) {
  return id.replace(/[^A-Za-z0-9_-]/g, "-");
}

/**
 * 出力先ディレクトリを排他的に作成する。existsSync確認+別途mkdirという2段階では
 * 同時実行時にTOCTOU競合(両方が「存在しない」を見てから両方が上書きしてしまう)が
 * 起こり得るため、mkdir(recursive:false)の失敗(EEXIST)自体を排他ロックとして使う。
 * @param {string} outDir - 作成する実行単位ディレクトリ
 * @param {string} rootDir - 親ディレクトリ(gkp-runs/自体は共有のためrecursive作成でよい)
 */
export async function createExclusiveRunDir(outDir, rootDir) {
  await mkdir(rootDir, { recursive: true });
  try {
    await mkdir(outDir, { recursive: false });
  } catch (e) {
    if (e.code === "EEXIST") {
      throw new Error(`出力先が既に存在します(上書きしません): ${outDir}`);
    }
    throw e;
  }
}

/**
 * 途中失敗時に、失敗であることが分かる最小限のメタデータだけを安全に残す。
 * それまでに部分的に書き出された可能性のあるCSV等は削除してから書き直す
 * (「メタデータだけを安全に残す」を文字通り保証するため)。
 * @param {string} outDir
 * @param {string} runId
 * @param {string} commandMode
 * @param {Error} error
 */
export async function writeFailureMetadata(outDir, runId, commandMode, error) {
  try {
    await mkdir(outDir, { recursive: true });
    const entries = await readdir(outDir).catch(() => []);
    await Promise.all(entries.map((name) => rm(join(outDir, name), { recursive: true, force: true })));
    await writeFile(
      join(outDir, "run-metadata.json"),
      JSON.stringify(
        { runId, executedAt: new Date().toISOString(), commandMode, status: "failed", error: error.message },
        null,
        2
      ),
      "utf-8"
    );
  } catch {
    // メタデータ書き込み自体に失敗しても、元のエラーで終了することを優先する
  }
}

/**
 * 楽天API異常率を評価する(2026-09-06 PR#4監査対応で抽出。テストで直接検証できるように、
 * gkp-dry-run.jsの本体ロジックから切り出した)。
 * @param {any[]} mappedCandidates - runMapRakuten()の戻り値
 * @param {number} threshold - これを超えたら異常とみなす比率(0〜1)
 * @returns {{ apiErrorCount: number, attemptedCount: number, apiErrorRate: number, exceeded: boolean }}
 */
export function evaluateApiErrorRate(mappedCandidates, threshold) {
  const apiErrorCount = mappedCandidates.filter((c) => c.rakutenLookupStatus === "API_ERROR").length;
  const attemptedCount = mappedCandidates.filter((c) => c.rakutenLookupStatus !== "NOT_RUN").length;
  const apiErrorRate = attemptedCount > 0 ? apiErrorCount / attemptedCount : 0;
  return { apiErrorCount, attemptedCount, apiErrorRate, exceeded: apiErrorRate > threshold };
}

/**
 * --max-rakuten-keywords の検証: 正の整数のみ許可し、100件を絶対上限にする
 * (全候補を誤って一括照合しないための安全弁)。
 * @param {string|undefined} raw
 * @returns {{ ok: true, value: number } | { ok: false, message: string }}
 */
export function validateMaxRakutenKeywords(raw) {
  const ABSOLUTE_MAX = 100;
  const value = Number(raw ?? 100);
  if (!Number.isFinite(value) || !Number.isInteger(value) || value <= 0) {
    return { ok: false, message: `--max-rakuten-keywords は正の整数で指定してください(指定値: ${raw})` };
  }
  if (value > ABSOLUTE_MAX) {
    return {
      ok: false,
      message: `--max-rakuten-keywords は${ABSOLUTE_MAX}件が絶対上限です(指定値: ${raw})。全候補を誤って一括照合しないための安全弁のため、${ABSOLUTE_MAX}件を超える値は指定できません。`,
    };
  }
  return { ok: true, value };
}
