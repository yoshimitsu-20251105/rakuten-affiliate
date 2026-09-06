// 入力ファイルパスの解決(2026-09-06 正式CLI対応)。
// Windowsネイティブ("C:\...")・Git Bash("/c/...")・WSL("/mnt/c/...")・通常の
// Linux/macOSパスのいずれで指定されても、安全に実在するファイルへ解決する。
// 曖昧な同名ファイル(異なる実体を指す複数候補)を勝手に選ばず、その場合はエラーにする。

import { existsSync, realpathSync } from "node:fs";
import { resolve as pathResolve } from "node:path";

/**
 * @param {string} rawPath - ユーザーが指定した入力パス(任意の表記)
 * @returns {string[]} 実在確認を試すべき候補パスの一覧(重複除去はしない)
 */
export function buildCandidatePaths(rawPath) {
  const candidates = [rawPath];

  // Git Bashマウント形式: /c/Users/... -> C:/Users/... , C:\Users\...
  const gitBashMatch = rawPath.match(/^\/([A-Za-z])\/(.*)$/);
  if (gitBashMatch) {
    const [, drive, rest] = gitBashMatch;
    candidates.push(`${drive.toUpperCase()}:/${rest}`);
    candidates.push(`${drive.toUpperCase()}:\\${rest.replace(/\//g, "\\")}`);
  }

  // WSLマウント形式: /mnt/c/Users/... -> C:/Users/... , C:\Users\...
  const wslMatch = rawPath.match(/^\/mnt\/([A-Za-z])\/(.*)$/);
  if (wslMatch) {
    const [, drive, rest] = wslMatch;
    candidates.push(`${drive.toUpperCase()}:/${rest}`);
    candidates.push(`${drive.toUpperCase()}:\\${rest.replace(/\//g, "\\")}`);
  }

  // Windowsパス(バックスラッシュ)からスラッシュ表記も試す(念のため)
  const winBackslashMatch = rawPath.match(/^([A-Za-z]):\\(.*)$/);
  if (winBackslashMatch) {
    const [, drive, rest] = winBackslashMatch;
    candidates.push(`${drive}:/${rest.replace(/\\/g, "/")}`);
  }

  // Windowsパス(スラッシュ)からバックスラッシュ表記も試す
  const winSlashMatch = rawPath.match(/^([A-Za-z]):\/(.*)$/);
  if (winSlashMatch) {
    const [, drive, rest] = winSlashMatch;
    candidates.push(`${drive}:\\${rest.replace(/\//g, "\\")}`);
  }

  return candidates;
}

/**
 * 入力パスを実在する1つのファイルへ解決する。存在しなければエラー、
 * 異なる実体を指す複数の候補が存在すれば(曖昧なため)エラーにする。
 * @param {string} rawPath
 * @returns {string} 解決済みの実在パス(realpath)
 */
export function resolveInputPath(rawPath) {
  if (!rawPath || typeof rawPath !== "string") {
    throw new Error("入力ファイルパスが指定されていません");
  }
  const candidates = buildCandidatePaths(rawPath);
  return pickUniqueRealFile(candidates, rawPath);
}

/**
 * 候補パスの一覧から、実在するファイルの実体(realpath)を一意に決定する。
 * 0件なら「見つからない」エラー、2件以上の異なる実体があれば「曖昧」エラーを投げる。
 * (resolveInputPathから切り出した純粋なロジック。テストで直接検証しやすくするため。)
 * @param {string[]} candidates
 * @param {string} [rawPathForMessage] - エラーメッセージ用の元入力(省略可)
 * @returns {string}
 */
export function pickUniqueRealFile(candidates, rawPathForMessage = candidates[0]) {
  const foundReal = new Map(); // realpath -> 元候補(ログ用)

  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    let real;
    try {
      real = realpathSync(candidate);
    } catch {
      real = pathResolve(candidate);
    }
    // Windowsはパスの大小文字を区別しないため、比較キーは小文字化する
    const key = real.toLowerCase();
    if (!foundReal.has(key)) foundReal.set(key, { real, candidate });
  }

  if (foundReal.size === 0) {
    throw new Error(
      `入力ファイルが見つかりません: "${rawPathForMessage}"(試したパス: ${candidates.join(", ")})`
    );
  }
  if (foundReal.size > 1) {
    const list = [...foundReal.values()].map((v) => v.real).join(", ");
    throw new Error(
      `入力パス"${rawPathForMessage}"に対して、異なる実体を指す複数のファイルが候補として見つかりました。` +
        `曖昧なため自動選択しません。一意なパスを指定してください(候補: ${list})`
    );
  }
  return [...foundReal.values()][0].real;
}
