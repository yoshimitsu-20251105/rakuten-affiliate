// Phase 3A(非公開下書きページ生成)専用: 既存サイト・既存パイプライン設定との
// slug重複・検索意図重複を検出する(読み取り専用)。2026-09-06の手動カニバリ監査
// (シニア犬フード/グレインフリードッグフード等がselect-products.jsの既存シード
// キーワードと重複していた実例)と同じ観点を、CLIの安全ゲートとして自動化したもの。
//
// 【重要】この自動判定は多層防御の1つであり、人間の判断を置き換えるものではない。
// 判定不能・抽出失敗の場合は必ず安全側(=重複ありとみなして拒否)に倒す。

import { readFile } from "node:fs/promises";
import { readdirSync, existsSync, statSync } from "node:fs";
import { extractAttributes } from "./attributes.js";

const SYNONYM_CANONICAL = [
  { canonical: "シニア", variants: ["高齢"] },
  { canonical: "グレインフリー", variants: ["穀物不使用", "穀物フリー"] },
  { canonical: "無添加", variants: ["添加物不使用"] },
];
// select-products.js側で「シニア犬」「シニア猫」のように空白無しの複合語表記が
// 使われているため、比較前に分割する。
const COMPOUND_SPLITS = [
  ["シニア犬", "シニア 犬"],
  ["シニア猫", "シニア 猫"],
  ["高齢犬", "高齢 犬"],
  ["高齢猫", "高齢 猫"],
];
// 動物種・商品種別・助詞など、単独では識別力を持たない語(比較対象から除外する)。
// 「国産」「無添加」「グレインフリー」等の属性語は除外しない(識別力があるため)。
const GENERIC_TOKENS = new Set([
  "犬", "猫", "ドッグ", "キャット", "ドッグフード", "キャットフード", "フード",
  "おやつ", "主食", "餌", "用", "の", "に", "は", "を", "が", "へ", "と", "で", "や",
]);

function detectSpecies(text) {
  const tags = extractAttributes(text);
  const dog = tags.includes("species:dog");
  const cat = tags.includes("species:cat");
  if (dog && !cat) return "dog";
  if (cat && !dog) return "cat";
  return "unknown";
}

function canonicalizeToken(token) {
  for (const { canonical, variants } of SYNONYM_CANONICAL) {
    if (token === canonical || variants.includes(token)) return canonical;
  }
  return token;
}

/**
 * @param {string} text
 * @returns {Set<string>} 識別力のある語(同義語正規化済み)の集合
 */
export function conceptSignature(text) {
  let s = String(text ?? "");
  for (const [compound, split] of COMPOUND_SPLITS) s = s.split(compound).join(split);
  const tokens = s.split(/[\s　]+/).filter(Boolean).map(canonicalizeToken);
  return new Set(tokens.filter((t) => !GENERIC_TOKENS.has(t)));
}

function isSubset(a, b) {
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

/**
 * 2つのキーワードが検索意図として重複するか判定する。
 * 動物種が明確に異なる場合は重複なしとする(犬用ページと猫用ページは競合しない)。
 * どちらかの概念シグネチャが空(判定材料が無い)場合は、過剰検出を避けるため
 * 「重複なし」とする(=このケースは目視確認に委ねる)。
 * @param {string} keywordA
 * @param {string} keywordB
 * @returns {boolean}
 */
export function keywordsConflict(keywordA, keywordB) {
  const speciesA = detectSpecies(keywordA);
  const speciesB = detectSpecies(keywordB);
  if (speciesA !== "unknown" && speciesB !== "unknown" && speciesA !== speciesB) return false;

  const sigA = conceptSignature(keywordA);
  const sigB = conceptSignature(keywordB);
  if (sigA.size === 0 || sigB.size === 0) return false;
  return isSubset(sigA, sigB) || isSubset(sigB, sigA);
}

/**
 * select-products.js(既存の日次パイプライン、keyword-researchとは独立)の
 * subKeywords配列(複数のtierオブジェクトに分かれて複数存在する)から、
 * 日本語を含む文字列リテラルをすべて抽出する(読み取り専用パース)。
 * 抽出に失敗した場合は例外を投げる(呼び出し側で安全側に倒すため)。
 * @param {string} projectRoot
 * @returns {Promise<string[]>}
 */
export async function extractExistingSeedKeywords(projectRoot) {
  const filePath = `${projectRoot}/select-products.js`;
  if (!existsSync(filePath)) {
    throw new Error(`select-products.jsが見つかりません: ${filePath}`);
  }
  const text = await readFile(filePath, "utf-8");

  // subKeywords: は複数のtierオブジェクトに分かれて複数回出現するため、すべて探索する。
  const occurrences = [];
  let searchFrom = 0;
  while (true) {
    const idx = text.indexOf("subKeywords:", searchFrom);
    if (idx === -1) break;
    occurrences.push(idx);
    searchFrom = idx + "subKeywords:".length;
  }
  if (occurrences.length === 0) {
    throw new Error("select-products.js内にsubKeywords:ブロックが見つかりません");
  }

  const literals = [];
  for (const startIdx of occurrences) {
    const openBracket = text.indexOf("[", startIdx);
    if (openBracket === -1) throw new Error("subKeywords:の開始括弧が見つかりません");
    let depth = 0;
    let endIdx = -1;
    for (let i = openBracket; i < text.length; i++) {
      if (text[i] === "[") depth++;
      else if (text[i] === "]") {
        depth--;
        if (depth === 0) {
          endIdx = i;
          break;
        }
      }
    }
    if (endIdx === -1) throw new Error("subKeywords:の終了括弧が見つかりません(閉じ括弧の対応が取れない)");

    const block = text.slice(openBracket, endIdx + 1);
    const withoutComments = block
      .split("\n")
      .map((line) => line.replace(/\/\/.*$/, ""))
      .join("\n");
    literals.push(...[...withoutComments.matchAll(/"([^"]+)"/g)].map((m) => m[1]));
  }

  // プロパティ名(keyword, requireRepeatSignal等)は英字のみのため、日本語を含む
  // ものだけをキーワード候補として残す(重複除去)。
  return [...new Set(literals.filter((s) => /[ぁ-んァ-ヶ一-龠]/.test(s)))];
}

/**
 * docs/rankings/配下の既存ランキングページのslug(拡張子除きファイル名)一覧を返す。
 * 【2026-09-07 PR#5監査対応】以前は存在しないディレクトリに対して空配列を返しており、
 * 「重複検出の判定材料が取得できない」状態と「本当に既存ページが0件」の状態を
 * 区別できなかった(前者を後者として扱うと、実際には既存ページ一覧を取得できて
 * いないのに重複無しと誤判定してしまう安全上のリスクがあった)。読取不能・
 * ディレクトリではない場合は例外を投げ、呼び出し側で安全側(全件拒否)に倒す。
 * 実在する空ディレクトリ(既存ページが本当に0件)は正しく空配列を返す。
 * @param {string} rankingsDir
 * @returns {string[]}
 */
export function listExistingRankingSlugs(rankingsDir) {
  if (!existsSync(rankingsDir)) {
    throw new Error(`既存ランキングページのディレクトリが見つかりません: ${rankingsDir}`);
  }
  let stat;
  try {
    stat = statSync(rankingsDir);
  } catch (e) {
    throw new Error(`既存ランキングページのディレクトリの状態を取得できません: ${rankingsDir}(${e.message})`);
  }
  if (!stat.isDirectory()) {
    throw new Error(`既存ランキングページのパスがディレクトリではありません: ${rankingsDir}`);
  }
  let entries;
  try {
    entries = readdirSync(rankingsDir);
  } catch (e) {
    throw new Error(`既存ランキングページのディレクトリを読み取れません: ${rankingsDir}(${e.message})`);
  }
  return entries.filter((f) => f.endsWith(".html")).map((f) => f.slice(0, -".html".length));
}

/**
 * 承認候補1件について、既存サイト・既存パイプライン設定とのslug重複・検索意図重複を
 * まとめて検出する。
 * @param {{ normalizedKeyword: string, slug: string }} candidate
 * @param {{ existingSlugs: string[], existingSeedKeywords: string[], batchSlugs: string[] }} inventory -
 *   batchSlugsは承認ファイル内の全slug(重複検出のため、重複除去しない配列で渡すこと。
 *   Setで渡すと重複が失われ判定できなくなるため不可)
 * @returns {string[]} 検出された問題の説明(空配列なら問題なし)
 */
export function findConflicts(candidate, inventory) {
  const issues = [];

  // slug重複(既存ランキングページ)
  if (inventory.existingSlugs.includes(candidate.slug)) {
    issues.push(`slug「${candidate.slug}」は既存のランキングページと重複しています`);
  }
  // slug重複(承認ファイル内の他候補、バッチ内重複)。normalizedKeywordの承認ファイル内
  // 重複はpilot-draft-approval.js側で既に拒否済みだが、ここでも独立に再チェックする
  // (多層防御。batchSlugsは重複を保持した配列で渡す必要がある)。
  const batchSlugList = inventory.batchSlugs ?? [];
  if (batchSlugList.filter((s) => s === candidate.slug).length > 1) {
    issues.push(`slug「${candidate.slug}」が承認ファイル内で重複しています`);
  }

  // 検索意図重複(既存パイプラインの設定済みシードキーワード)
  for (const seed of inventory.existingSeedKeywords) {
    if (keywordsConflict(candidate.normalizedKeyword, seed)) {
      issues.push(`検索意図が既存の設定済みキーワード「${seed}」(select-products.js)と重複しています`);
    }
  }

  return issues;
}
