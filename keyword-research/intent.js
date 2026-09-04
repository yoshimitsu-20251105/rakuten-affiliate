// 検索意図分類(ルールベース、外部LLM不要・再現可能)。
// 医療関連語彙の判定を最優先で行う(MEDICAL_REVIEW_REQUIREDは他の分類より常に優先)。

/** @typedef {import('./types.js').SearchIntent} SearchIntent */

/**
 * @param {string} canonicalKeyword
 * @param {{medicalTerms: string[], intentKeywords: Record<string,string[]>}} config
 * @returns {{ intent: SearchIntent, reasons: string[] }}
 */
export function classifyIntent(canonicalKeyword, config) {
  const text = canonicalKeyword;
  const reasons = [];

  // 1. 医療・疾病語彙は最優先(自動公開禁止の判断に直結するため、他条件より先に判定する)
  const matchedMedical = (config.medicalTerms ?? []).filter((term) => text.includes(term));
  if (matchedMedical.length > 0) {
    reasons.push(`医療関連語を検出: ${matchedMedical.join(", ")}`);
    return { intent: "MEDICAL_REVIEW_REQUIRED", reasons };
  }

  // 2. 優先順位付きでその他の意図を判定(EXACT_PRODUCT → CONDITION_PURCHASE →
  //    COMMERCIAL_COMPARISON → PROBLEM_SOLUTION → INFORMATIONAL)
  const order = ["EXACT_PRODUCT", "CONDITION_PURCHASE", "COMMERCIAL_COMPARISON", "PROBLEM_SOLUTION", "INFORMATIONAL"];
  for (const intent of order) {
    const keywords = config.intentKeywords?.[intent] ?? [];
    const matched = keywords.filter((kw) => text.includes(kw));
    if (matched.length > 0) {
      reasons.push(`${intent}語を検出: ${matched.join(", ")}`);
      return { intent, reasons };
    }
  }

  reasons.push("いずれの意図語彙にも一致せず、INFORMATIONALとして扱う(フォールバック)");
  return { intent: "INFORMATIONAL", reasons };
}
