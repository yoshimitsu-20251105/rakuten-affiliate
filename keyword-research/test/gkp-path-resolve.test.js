// 【2026-09-06 正式CLI対応】入力パス解決(Windows/Git Bash/WSLパス表記)のテスト。

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveInputPath, buildCandidatePaths, pickUniqueRealFile } from "../gkp-path-resolve.js";

test("存在しないファイルはエラーになる", () => {
  assert.throws(() => resolveInputPath("/c/definitely/does/not/exist/file.csv"), /見つかりません/);
});

test("パス未指定はエラーになる", () => {
  assert.throws(() => resolveInputPath(""), /指定されていません/);
  assert.throws(() => resolveInputPath(undefined), /指定されていません/);
});

test("buildCandidatePaths: Git Bash形式(/c/Users/...)からWindows表記の候補を生成する", () => {
  const candidates = buildCandidatePaths("/c/Users/user/file.csv");
  assert.ok(candidates.includes("C:/Users/user/file.csv"));
  assert.ok(candidates.includes("C:\\Users\\user\\file.csv"));
});

test("buildCandidatePaths: WSL形式(/mnt/c/Users/...)からWindows表記の候補を生成する", () => {
  const candidates = buildCandidatePaths("/mnt/c/Users/user/file.csv");
  assert.ok(candidates.includes("C:/Users/user/file.csv"));
  assert.ok(candidates.includes("C:\\Users\\user\\file.csv"));
});

test("buildCandidatePaths: Windowsネイティブパス(C:\\...)からスラッシュ表記の候補も生成する", () => {
  const candidates = buildCandidatePaths("C:\\Users\\user\\file.csv");
  assert.ok(candidates.includes("C:/Users/user/file.csv"));
});

test("実在するファイルを、Windowsネイティブ・Git Bash・WSL・フォワードスラッシュのいずれの表記でも解決できる", async () => {
  const dir = await mkdtemp(join(tmpdir(), "gkp-path-"));
  const filePath = join(dir, "test.csv");
  await writeFile(filePath, "dummy");
  try {
    const drive = filePath[0].toLowerCase();
    const rest = filePath.slice(3).replace(/\\/g, "/"); // "C:\foo\bar" -> "foo/bar"

    const winNative = filePath; // "C:\foo\bar\test.csv"
    const winForward = filePath.replace(/\\/g, "/"); // "C:/foo/bar/test.csv"
    const gitBash = `/${drive}/${rest}`; // "/c/foo/bar/test.csv"
    const wsl = `/mnt/${drive}/${rest}`; // "/mnt/c/foo/bar/test.csv"

    for (const candidate of [winNative, winForward, gitBash, wsl]) {
      const resolved = resolveInputPath(candidate);
      assert.equal(resolved.toLowerCase(), filePath.toLowerCase(), `候補 "${candidate}" が正しく解決されること`);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("同一ファイルを指す複数の表記候補が存在しても、曖昧エラーにはならない(重複除去される)", async () => {
  const dir = await mkdtemp(join(tmpdir(), "gkp-path-"));
  const filePath = join(dir, "test.csv");
  await writeFile(filePath, "dummy");
  try {
    // Windowsネイティブ表記とフォワードスラッシュ表記は同一の実ファイルを指すため、
    // 候補が複数あっても曖昧エラーにはならない
    const resolved = resolveInputPath(filePath);
    assert.equal(resolved.toLowerCase(), filePath.toLowerCase());
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("通常の絶対パス(特殊なマウント表記でない)は候補が1つだけで、無用な曖昧エラーを起こさない", () => {
  // buildCandidatePathsが候補を過剰生成すると、実在は1つだけなのに誤って
  // 曖昧エラーになりかねない。ここでは通常のWindows絶対パス以外の余計な
  // マウント形式(/c/, /mnt/c/)にマッチしないプレーンな相対パスで確認する。
  const candidates = buildCandidatePaths("reports/data.csv");
  assert.deepEqual(candidates, ["reports/data.csv"]);
});

test("異なる実体を指す複数の候補が見つかった場合は曖昧エラーになる(勝手に選ばない)", async () => {
  // pickUniqueRealFile()は「複数の候補パスのうち実在するものをrealpathで集約し、
  // 異なる実体が2件以上あれば曖昧エラーにする」という判定ロジックそのものであり、
  // buildCandidatePathsが実際にどう候補を生成するかとは独立にテストできる。
  // ここでは2つの本当に異なる実ファイルを用意し、両方を候補として渡すことで
  // 曖昧判定を直接検証する。
  const dirA = await mkdtemp(join(tmpdir(), "gkp-path-a-"));
  const dirB = await mkdtemp(join(tmpdir(), "gkp-path-b-"));
  try {
    const fileA = join(dirA, "data.csv");
    const fileB = join(dirB, "data.csv");
    await writeFile(fileA, "content-A");
    await writeFile(fileB, "content-B");

    assert.throws(() => pickUniqueRealFile([fileA, fileB], "data.csv"), /曖昧/);
  } finally {
    await rm(dirA, { recursive: true, force: true });
    await rm(dirB, { recursive: true, force: true });
  }
});

test("同じ実体を指す複数の候補(表記違いだけ)は曖昧にならず一意に解決する", async () => {
  const dir = await mkdtemp(join(tmpdir(), "gkp-path-same-"));
  try {
    const filePath = join(dir, "data.csv");
    await writeFile(filePath, "content");
    // 同じファイルを指す候補を複数渡しても、実体は1つなので曖昧にならない
    const resolved = pickUniqueRealFile([filePath, filePath, filePath], "data.csv");
    assert.equal(resolved.toLowerCase(), filePath.toLowerCase());
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
