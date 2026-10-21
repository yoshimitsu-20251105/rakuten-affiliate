import { hash } from "../market-scanner/model.js";

export const MAX_SCORES = Object.freeze({ purchaseIntent: 35, offerFit: 30, lpReuse: 20, demand: 15 });
export const COMPONENTS = Object.freeze(Object.keys(MAX_SCORES));
export const PERFORMANCE_METRICS = Object.freeze(["approvedRevenue", "revenue", "conversions", "epc"]);
export const POLICY = Object.freeze({
  version: "opportunity-scorer-v1",
  evidenceType: "HYPOTHESIS",
  maxScores: MAX_SCORES,
  intentPoints: Object.freeze({ EXACT_PRODUCT: 35, CONDITION_PURCHASE: 26.25, COMMERCIAL_COMPARISON: 26.25 }),
  missingTotal: null,
});
export const POLICY_HASH = hash(POLICY);

// Values are already weighted points. No financial metric enters this function.
export function totalScore(components) {
  if (COMPONENTS.some((key) => components[key].value === null || components[key].evidenceType === "UNKNOWN")) return null;
  return Math.round((COMPONENTS.reduce((sum, key) => sum + components[key].value, 0) + Number.EPSILON) * 100) / 100;
}
