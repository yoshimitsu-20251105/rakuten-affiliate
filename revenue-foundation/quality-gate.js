export const WEIGHTS = Object.freeze({
  searchIntentFit: 15, originalAnalysis: 20, comparisonSpecificity: 15, freshness: 10,
  evidence: 10, titleH1Alignment: 5, internalLinks: 5, mobileUX: 5, performance: 5,
  ctaFit: 5, affiliateCompliance: 5,
});
export const THRESHOLD = 80;

const gates = ["affiliateCompliance", "fakeExperience", "scaledContentRisk", "requiredEvidence"];
const states = ["PASS", "FAIL", "UNKNOWN"];
const experiencePattern = /(?:愛用|実際に(?:使用|利用|試用)|使っ(?:た|てみた)|試し(?:た|てみた)|(?:I|we) (?:used|tested|tried))/iu;
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;

export function evaluateQuality(input) {
  if (input?.schemaVersion !== 1 || !Array.isArray(input.evidence)) throw Error("Invalid Quality Gate input");
  const evidence = new Map();
  for (const item of input.evidence) {
    if (typeof item?.id !== "string" || !item.id.trim() || evidence.has(item.id) ||
      typeof item.sourceRef !== "string" || !item.sourceRef.trim() ||
      typeof item.isSynthetic !== "boolean" || !["FACT", "ESTIMATE", "HYPOTHESIS"].includes(item.evidenceType) ||
      item.isSynthetic && item.evidenceType === "FACT") throw Error("Invalid Quality Gate evidence");
    evidence.set(item.id, { id: item.id, sourceRef: item.sourceRef, evidenceType: item.evidenceType, isSynthetic: item.isSynthetic });
  }
  const refs = (ids) => [...new Set(Array.isArray(ids) ? ids : [])]
    .filter((id) => evidence.has(id) && !evidence.get(id).isSynthetic).sort(compare);
  const hardGates = {};
  const blockingReasons = [];
  const warnings = [];

  for (const name of gates) {
    const observation = input.gates?.[name];
    let status = observation?.status ?? "UNKNOWN";
    if (!states.includes(status)) throw Error("Invalid hard gate status");
    if (status === "PASS" && !refs(observation.evidenceRefs).some((id) => evidence.get(id).evidenceType === "FACT")) status = "UNKNOWN";
    hardGates[name] = status;
  }

  const claims = input.experienceClaims ?? [];
  if (!Array.isArray(claims)) throw Error("Invalid experience claims");
  for (const claim of claims) {
    if (typeof claim?.text !== "string" || !["USED", "NOT_USED", "UNKNOWN"].includes(claim.actualUse)) throw Error("Invalid experience claim");
  }
  const detected = claims.filter((claim) => claim.firstHand === true || experiencePattern.test(claim.text));
  if (detected.some((claim) => claim.actualUse === "NOT_USED")) hardGates.fakeExperience = "FAIL";
  else if (hardGates.fakeExperience !== "FAIL" && (detected.some((claim) => claim.actualUse !== "USED" ||
    !refs(claim.evidenceRefs).some((id) => evidence.get(id).evidenceType === "FACT")) ||
    typeof input.content === "string" && experiencePattern.test(input.content) &&
      !input.content.split(/[。！？\n]+/u).filter((line) => experiencePattern.test(line))
        .every((line) => detected.some((claim) => claim.text === line.trim())))) hardGates.fakeExperience = "UNKNOWN";

  const risks = input.scaledContentSignals ?? [];
  if (!Array.isArray(risks) || risks.some((risk) => !["DOORWAY", "NEAR_DUPLICATE", "THIN_MASS_CONTENT"].includes(risk))) throw Error("Invalid scaled-content signals");
  if (risks.length) hardGates.scaledContentRisk = "FAIL";

  const dimensions = {};
  for (const [name, maxPoints] of Object.entries(WEIGHTS)) {
    const dimension = input.dimensions?.[name];
    const evidenceRefs = refs(dimension?.evidenceRefs);
    let points = dimension?.points ?? null;
    if (points !== null && (!Number.isInteger(points) || points < 0 || points > maxPoints)) throw Error("Invalid dimension score");
    if (!evidenceRefs.length || name === "affiliateCompliance" && hardGates.affiliateCompliance !== "PASS") points = null;
    if (points === null) warnings.push(`${name}: UNKNOWN`);
    if (name !== "affiliateCompliance" && dimension?.required === true && points === null && hardGates.requiredEvidence !== "FAIL") {
      hardGates.requiredEvidence = "UNKNOWN";
    }
    dimensions[name] = { points, maxPoints, status: points === null ? "UNKNOWN" : "ASSESSED", evidenceRefs };
  }
  for (const name of gates) {
    if (hardGates[name] !== "PASS") blockingReasons.push(`${name}: ${hardGates[name]}`);
  }
  const score = Object.values(dimensions).reduce((sum, dimension) => sum + (dimension.points ?? 0), 0);
  const possibleScore = score + Object.values(dimensions).filter((dimension) => dimension.points === null)
    .reduce((sum, dimension) => sum + dimension.maxPoints, 0);
  if (possibleScore < THRESHOLD) blockingReasons.push("Score below threshold");
  else if (score < THRESHOLD) blockingReasons.push("Threshold not established");
  const status = Object.values(hardGates).includes("FAIL") || possibleScore < THRESHOLD ? "FAIL" :
    Object.values(hardGates).includes("UNKNOWN") || score < THRESHOLD ? "UNKNOWN" : "PASS";
  return { score, threshold: THRESHOLD, status, hardGates, dimensions, blockingReasons, warnings,
    evidence: [...evidence.values()].sort((a, b) => compare(a.id, b.id)) };
}
