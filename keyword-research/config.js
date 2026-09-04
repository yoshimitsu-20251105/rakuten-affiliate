// Webキーワードリサーチ機能の設定。配点・しきい値・クラスター定義・医療語彙・
// 同義語辞書をここに集約し、設定ファイル(config.local.json)から上書きできるようにする。

import { readFile } from "node:fs/promises";

/** @typedef {import('./types.js').SearchIntent} SearchIntent */

// ---- 対象国・言語・期間 ----
export const DEFAULT_REGION = { country: "JP", language: "ja", timezone: "Asia/Tokyo" };

// ---- 初期6クラスター(ユーザー指定) ----
// requiredTokensの各要素は文字列(その部分文字列が含まれること)、または
// 文字列配列(いずれか1つでも含まれればOKなORグループ)。
// 犬/猫の判定は「ドッグフード」のようにカタカナ複合語だと同義語辞書のトークン単位
// 置換が効かない(空白で区切られていないため)ため、OR条件で両表記を直接列挙する。
export const CLUSTERS = [
  {
    id: "domestic-additive-free-dog-food",
    label: "国産無添加ドッグフード",
    species: "dog",
    lifeStage: null,
    requiredTokens: ["国産", "無添加", ["犬", "ドッグ"], ["フード", "主食"]],
  },
  {
    id: "domestic-additive-free-cat-food",
    label: "国産無添加キャットフード",
    species: "cat",
    lifeStage: null,
    requiredTokens: ["国産", "無添加", ["猫", "キャット"], ["フード", "主食"]],
  },
  {
    id: "senior-dog-food",
    label: "シニア犬フード",
    species: "dog",
    lifeStage: "senior",
    requiredTokens: ["シニア", ["犬", "ドッグ"]],
  },
  {
    id: "senior-cat-food",
    label: "シニア猫フード",
    species: "cat",
    lifeStage: "senior",
    requiredTokens: ["シニア", ["猫", "キャット"]],
  },
  {
    id: "grain-free-pet-food",
    label: "グレインフリーペットフード",
    species: null,
    lifeStage: null,
    requiredTokens: ["グレインフリー"],
  },
  {
    id: "domestic-additive-free-dog-treats",
    label: "国産無添加犬用おやつ",
    species: "dog",
    lifeStage: null,
    requiredTokens: ["国産", "無添加", "おやつ", ["犬", "ドッグ"]],
  },
];

// ---- 同義語辞書(限定的。高度なブランド正規化は行わない) ----
export const SYNONYM_DICTIONARY = {
  "犬": ["ドッグ", "わんこ", "ワンちゃん"],
  "猫": ["キャット", "ねこ", "ニャンコ"],
  "ドッグフード": ["犬 フード", "犬用フード", "犬フード"],
  "キャットフード": ["猫 フード", "猫用フード", "猫フード"],
  "おやつ": ["トリーツ", "スナック"],
  "無添加": ["添加物不使用", "無添加物"],
  "国産": ["日本製", "日本産"],
  "シニア": ["高齢", "老犬", "老猫"],
};

// ---- 医療・疾病語彙(MEDICAL_REVIEW_REQUIREDの判定に使用。自動公開しない) ----
export const MEDICAL_TERMS = [
  "治る", "治療", "改善", "予防", "療法食", "薬", "サプリメント 効果",
  "病気", "疾患", "アレルギー 完治", "腫瘍", "がん", "糖尿病", "腎臓病",
  "皮膚病", "下痢 治療", "嘔吐 対処", "獣医", "診断",
];

// ---- 検索意図分類の語彙(ルールベース。医療語彙が最優先で判定される) ----
export const INTENT_KEYWORDS = {
  EXACT_PRODUCT: ["送料無料", "ml", "kg", "g入り", "セット", "型番"],
  CONDITION_PURCHASE: ["国産", "無添加", "グレインフリー", "小粒", "シニア", "小型犬", "子犬", "子猫"],
  COMMERCIAL_COMPARISON: ["おすすめ", "比較", "ランキング", "口コミ", "評判", "人気"],
  PROBLEM_SOLUTION: ["食べない", "好き嫌い", "保存方法", "与え方", "切り替え方"],
  INFORMATIONAL: ["とは", "意味", "原料", "違い"],
};

// ---- WebKeywordScoreの配点(合計100点) ----
// adsCompetitionGap: Google Ads Keyword Planningの入札競合指標(competitionLevel/
// competitionIndex)にもとづく代理指標。自然検索(SEO)の競合そのものではない点に注意。
export const SCORE_WEIGHTS = {
  demand: 30,
  purchaseIntent: 25,
  adsCompetitionGap: 15,
  trendAndStability: 10,
  rakutenSupplyFit: 10,
  clusterFit: 10,
};

// ---- FinalPriorityの重み ----
export const FINAL_PRIORITY_WEIGHTS = { webKeywordScore: 0.6, productQualityScore: 0.4 };

// ---- 採用しきい値 ----
export const ADOPTION_THRESHOLDS = {
  priority: 70, // 優先候補
  test: 60, // テスト候補
  observe: 50, // 継続観測
  // 49点以下は原則除外
};

// ---- 楽天照合の必須条件 ----
export const MATCHING_RULES = {
  minEligibleProductsForRankingPage: 3, // これ未満はランキングページ化しない(候補保存は可)
};

// ---- 月間検索数の正規化(対数変換の底) ----
export const DEMAND_NORMALIZATION = {
  // log(volume+1) / log(cap+1) で0〜1に正規化し、SCORE_WEIGHTS.demand を掛ける
  volumeCapForLog: 50000,
};

/**
 * config.local.json (gitignore対象、任意) があれば深いマージで上書きする。
 * 秘密情報はここに置かない(あくまで配点・しきい値等の運用値のみ)。
 */
export async function loadConfig(overridePath = new URL("./config.local.json", import.meta.url)) {
  const base = {
    region: DEFAULT_REGION,
    clusters: CLUSTERS,
    synonyms: SYNONYM_DICTIONARY,
    medicalTerms: MEDICAL_TERMS,
    intentKeywords: INTENT_KEYWORDS,
    scoreWeights: SCORE_WEIGHTS,
    finalPriorityWeights: FINAL_PRIORITY_WEIGHTS,
    adoptionThresholds: ADOPTION_THRESHOLDS,
    matchingRules: MATCHING_RULES,
    demandNormalization: DEMAND_NORMALIZATION,
  };
  try {
    const raw = await readFile(overridePath, "utf-8");
    const override = JSON.parse(raw);
    return deepMerge(base, override);
  } catch {
    return base; // 上書きファイルがなければデフォルトのみ使用
  }
}

function deepMerge(base, override) {
  if (Array.isArray(base) || Array.isArray(override)) return override ?? base;
  if (typeof base !== "object" || base === null) return override ?? base;
  const result = { ...base };
  for (const key of Object.keys(override ?? {})) {
    result[key] = deepMerge(base[key], override[key]);
  }
  return result;
}
