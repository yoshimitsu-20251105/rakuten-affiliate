// 【2026-09-07 Phase 3A対応】slug重複・検索意図重複検出のテスト。
// 2026-09-06の手動カニバリ監査で判明した実例(シニア犬フード/グレインフリー
// ドッグフード等がselect-products.jsの既存シードキーワードと重複)を再現して検証する。

import { test } from "node:test";
import assert from "node:assert/strict";
import { keywordsConflict, conceptSignature, extractExistingSeedKeywords, listExistingRankingSlugs, findConflicts } from "../pilot-draft-conflict-check.js";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = fileURLToPath(new URL("../../", import.meta.url)).replace(/[\\/]$/, "");

test("keywordsConflict: 犬用と猫用は動物種が異なるため重複しない", () => {
  assert.equal(keywordsConflict("キャットフード グレインフリー", "グレインフリー 国産 ドッグフード"), false);
});

test("keywordsConflict: シニア犬(複合語)とシニア 犬(空白区切り)は同義として扱われる", () => {
  assert.equal(keywordsConflict("シニア 犬 フード", "シニア犬 国産 無添加"), true);
});

test("keywordsConflict: 高齢猫とシニア猫は同義語として重複判定される", () => {
  assert.equal(keywordsConflict("高齢 猫 フード", "シニア猫 国産 無添加"), true);
});

test("keywordsConflict: グレインフリーと穀物不使用は同義語として重複判定される", () => {
  assert.equal(keywordsConflict("穀物不使用 ドッグフード", "グレインフリー 国産 ドッグフード"), true);
});

test("keywordsConflict: 無添加と添加物不使用は同義語として重複判定される", () => {
  assert.equal(keywordsConflict("添加物不使用 キャットフード", "国産 無添加 キャットフード"), true);
});

test("keywordsConflict: 完全一致は重複と判定される", () => {
  assert.equal(keywordsConflict("国産 無添加 キャットフード", "国産 無添加 キャットフード"), true);
});

test("keywordsConflict: 特定のタンパク源に特化した候補は、一般的な既存キーワードと重複しない", () => {
  // 「シニア犬 豚肉」は「シニア犬 国産 無添加」の部分集合ではなく、独自の切り口
  assert.equal(keywordsConflict("シニア 犬 豚肉", "シニア犬 国産 無添加"), false);
});

test("keywordsConflict: 判定材料が無い(識別力のある語が両方とも空)場合は過剰検出しない", () => {
  assert.equal(keywordsConflict("犬 フード", "猫 フード"), false);
});

test("conceptSignature: 動物種・商品種別・助詞を除去し、属性語だけを残す", () => {
  const sig = conceptSignature("シニア犬 国産 無添加");
  assert.deepEqual([...sig].sort(), ["シニア", "国産", "無添加"]);
});

test("extractExistingSeedKeywords: 実際のselect-products.jsから既知のペット関連キーワードを抽出できる", async () => {
  const seeds = await extractExistingSeedKeywords(PROJECT_ROOT);
  assert.ok(seeds.includes("国産 無添加 キャットフード"));
  assert.ok(seeds.includes("シニア犬 国産 無添加"));
  assert.ok(seeds.includes("グレインフリー 国産 ドッグフード"));
});

test("extractExistingSeedKeywords: 存在しないプロジェクトルートはエラーを投げる(安全側)", async () => {
  await assert.rejects(() => extractExistingSeedKeywords("/definitely/does/not/exist"));
});

test("listExistingRankingSlugs: 実際のdocs/rankings/から既存slugを取得できる", () => {
  const slugs = listExistingRankingSlugs(`${PROJECT_ROOT}/docs/rankings`);
  assert.ok(slugs.includes("petfood-sougou"));
  assert.ok(slugs.length > 0);
});

test("listExistingRankingSlugs: 存在しないディレクトリは例外を投げる(2026-09-07 PR#5監査対応: 空配列を返さない。判定材料が無いことと既存ページ0件を区別する)", () => {
  assert.throws(() => listExistingRankingSlugs("/definitely/does/not/exist"), /見つかりません/);
});

test("listExistingRankingSlugs: 実在する空ディレクトリは空配列を返す(既存ページが本当に0件のケースは許可する)", async () => {
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = await mkdtemp(join(tmpdir(), "empty-rankings-"));
  try {
    assert.deepEqual(listExistingRankingSlugs(dir), []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("listExistingRankingSlugs: ディレクトリではない(ファイル)パスは例外を投げる", async () => {
  const { mkdtemp, writeFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = await mkdtemp(join(tmpdir(), "not-a-dir-"));
  const filePath = join(dir, "not-a-directory.txt");
  await writeFile(filePath, "dummy", "utf-8");
  try {
    assert.throws(() => listExistingRankingSlugs(filePath), /ディレクトリではありません/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("findConflicts: 実データで、承認予定の2件が既存slug・既存シードキーワードのいずれとも衝突しない", async () => {
  const existingSeedKeywords = await extractExistingSeedKeywords(PROJECT_ROOT);
  const existingSlugs = listExistingRankingSlugs(`${PROJECT_ROOT}/docs/rankings`);
  const batchSlugs = ["senior-dog-pork", "grain-free-cat-food"];

  const issuesA = findConflicts({ normalizedKeyword: "シニア 犬 豚肉", slug: "senior-dog-pork" }, { existingSlugs, existingSeedKeywords, batchSlugs });
  const issuesB = findConflicts({ normalizedKeyword: "キャットフード グレインフリー", slug: "grain-free-cat-food" }, { existingSlugs, existingSeedKeywords, batchSlugs });
  assert.deepEqual(issuesA, []);
  assert.deepEqual(issuesB, []);
});

test("findConflicts: 既存シードキーワードと重複する候補は問題として検出される", async () => {
  const existingSeedKeywords = await extractExistingSeedKeywords(PROJECT_ROOT);
  const existingSlugs = listExistingRankingSlugs(`${PROJECT_ROOT}/docs/rankings`);
  const batchSlugs = ["senior-dog-food"];

  const issues = findConflicts({ normalizedKeyword: "シニア 犬 フード", slug: "senior-dog-food" }, { existingSlugs, existingSeedKeywords, batchSlugs });
  assert.ok(issues.length > 0);
  assert.match(issues.join(""), /シニア犬 国産 無添加/);
});

test("findConflicts: slugが既存ランキングページと重複する場合は検出される", () => {
  const issues = findConflicts(
    { normalizedKeyword: "テスト", slug: "petfood-sougou" },
    { existingSlugs: ["petfood-sougou"], existingSeedKeywords: [], batchSlugs: ["petfood-sougou"] }
  );
  assert.match(issues.join(""), /既存のランキングページ/);
});

test("findConflicts: 承認ファイル内でslugが重複している場合は検出される", () => {
  const batchSlugs = ["dup-slug", "dup-slug"]; // 配列で渡す(Setは重複を保持できないため不可)
  const issues = findConflicts({ normalizedKeyword: "テストA", slug: "dup-slug" }, { existingSlugs: [], existingSeedKeywords: [], batchSlugs });
  assert.match(issues.join(""), /承認ファイル内で重複/);
});
