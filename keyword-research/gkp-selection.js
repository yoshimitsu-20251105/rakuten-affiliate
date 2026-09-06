// 楽天API照合へ渡す候補の安全な選出(2026-09-06 正式CLI対応)。
// 一回限りスクリプト(keyword-research/output/run-gkp-analysis.js)で検証済みの
// 選出条件を、正式なライブラリ関数として実装する(ad-hocスクリプトからは
// importしない。逆にこちらがad-hocスクリプトの実装を置き換える)。
//
// 楽天APIへ照合する候補は次をすべて満たすものに限定する:
//   - businessValidated=true(需要データが実データとして検証済み)
//   - safetyStatus=SAFE(医療・健康訴求語を含まない)
//   - queryQualityStatus=VALID(不自然な検索語でない)
//   - 購入意図あり(EXACT_PRODUCT/CONDITION_PURCHASE/COMMERCIAL_COMPARISON)
//   - 医療関連(intent=MEDICAL_REVIEW_REQUIRED)でない(safetyStatusと独立した多層防御)
// 犬50件・猫50件を基本とし、--max-rakuten-keywordsで全体件数の上限を設ける
// (全948件を誤って一括照合しないようにするため)。

import { computeWebKeywordScore } from "./scoring.js";
import { extractAttributes } from "./attributes.js";

const PURCHASE_INTENTS = new Set(["EXACT_PRODUCT", "CONDITION_PURCHASE", "COMMERCIAL_COMPARISON"]);

/**
 * @param {string} canonicalKeyword
 * @returns {'dog'|'cat'|'ambiguous'|'unknown'}
 */
export function detectAnimalTypeFromKeyword(canonicalKeyword) {
  const tags = extractAttributes(canonicalKeyword);
  const isDog = tags.includes("species:dog");
  const isCat = tags.includes("species:cat");
  if (isDog && !isCat) return "dog";
  if (isCat && !isDog) return "cat";
  if (isDog && isCat) return "ambiguous";
  return "unknown";
}

/**
 * research段階の候補(まだ楽天照合前)にpreScore(businessValidated判定含む)を付与する。
 * eligibleRakutenCountはまだ不明なため0を暫定値として渡す(businessValidatedの算出には
 * 影響しない)。
 * @param {any[]} candidates
 * @param {any} config
 */
export function attachPreScore(candidates, config) {
  return candidates.map((c) => ({
    ...c,
    preScore: computeWebKeywordScore(c.observation, c.intent, c.cluster, 0, config, {}),
    detectedAnimalType: detectAnimalTypeFromKeyword(c.canonicalKeyword),
  }));
}

/**
 * @param {any[]} candidatesWithPreScore - attachPreScore()済みの候補
 * @param {{ maxKeywords?: number, dogLimit?: number, catLimit?: number }} options
 * @returns {{ selected: any[], excluded: Array<{ candidate: any, reasons: string[] }> }}
 */
export function selectCandidatesForRakuten(candidatesWithPreScore, options = {}) {
  const maxKeywords = options.maxKeywords ?? 100;
  const dogLimit = options.dogLimit ?? Math.min(50, Math.ceil(maxKeywords / 2));
  const catLimit = options.catLimit ?? Math.min(maxKeywords - dogLimit, 50);

  const excluded = [];
  const eligiblePool = [];

  for (const c of candidatesWithPreScore) {
    const reasons = [];
    if (!c.preScore.businessValidated) reasons.push("BUSINESS_DATA_NOT_VALIDATED");
    if (c.safetyStatus === "MEDICAL_REVIEW_REQUIRED") reasons.push("MEDICAL_REVIEW_REQUIRED");
    if (c.safetyStatus === "HEALTH_REVIEW_REQUIRED") reasons.push("HEALTH_REVIEW_REQUIRED");
    if (c.queryQualityStatus !== "VALID") reasons.push(`QUERY_QUALITY_${c.queryQualityStatus}`);
    if (c.intent === "MEDICAL_REVIEW_REQUIRED") reasons.push("INTENT_MEDICAL_REVIEW_REQUIRED");
    if (!PURCHASE_INTENTS.has(c.intent)) reasons.push("NO_PURCHASE_INTENT");

    if (reasons.length > 0) {
      excluded.push({ candidate: c, reasons });
    } else {
      eligiblePool.push(c);
    }
  }

  const dogPool = eligiblePool
    .filter((c) => c.detectedAnimalType === "dog")
    .sort((a, b) => b.preScore.total - a.preScore.total);
  const catPool = eligiblePool
    .filter((c) => c.detectedAnimalType === "cat")
    .sort((a, b) => b.preScore.total - a.preScore.total);
  const otherPool = eligiblePool.filter((c) => c.detectedAnimalType !== "dog" && c.detectedAnimalType !== "cat");

  const selectedDog = dogPool.slice(0, dogLimit);
  const selectedCat = catPool.slice(0, catLimit);
  const selected = [...selectedDog, ...selectedCat].slice(0, maxKeywords);

  const selectedKeys = new Set(selected.map((c) => c.canonicalKeyword));
  for (const c of dogPool.slice(dogLimit)) {
    if (!selectedKeys.has(c.canonicalKeyword)) excluded.push({ candidate: c, reasons: ["NOT_IN_TOP_N_BY_SCORE(dog)"] });
  }
  for (const c of catPool.slice(catLimit)) {
    if (!selectedKeys.has(c.canonicalKeyword)) excluded.push({ candidate: c, reasons: ["NOT_IN_TOP_N_BY_SCORE(cat)"] });
  }
  for (const c of otherPool) {
    excluded.push({ candidate: c, reasons: ["ANIMAL_TYPE_UNKNOWN_OR_AMBIGUOUS"] });
  }

  return {
    selected,
    excluded,
    poolStats: {
      eligiblePoolCount: eligiblePool.length,
      dogPoolCount: dogPool.length,
      catPoolCount: catPool.length,
      otherPoolCount: otherPool.length,
      selectedDogCount: selectedDog.length,
      selectedCatCount: selectedCat.length,
    },
  };
}
