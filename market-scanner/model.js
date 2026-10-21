import { createHash } from "node:crypto";

export const SCHEMA_VERSION = 1;
export const EVIDENCE_TYPES = ["FACT", "ESTIMATE", "HYPOTHESIS", "UNKNOWN"];
export const SOURCE_TYPES = ["gkp_csv", "manual_csv", "gsc_csv", "gsc_report", "opportunities", "experiments", "decisions", "seasonality", "funnel_report", "competitors", "lp_inventory", "offers", "measurement_records"];
export const assert = (condition, message) => { if (!condition) throw new Error(message); };
export const canonical = (v) => JSON.stringify(v, (_, x) => x && !Array.isArray(x) && typeof x === "object" ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, x[k]])) : x);
export const hash = (v) => createHash("sha256").update(typeof v === "string" || Buffer.isBuffer(v) ? v : canonical(v)).digest("hex");
export const phrase = (s) => String(s ?? "").normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();

export function date(value, name) {
  const time = Date.parse(`${value}T00:00:00Z`);
  assert(typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value, `${name}: 日付が不正です`);
  return value;
}
export function timestamp(value, name) {
  assert(typeof value === "string" && /^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value)), `${name}: timezone付き日時が必要です`);
  date(value.slice(0, 10), name);
  return new Date(value).toISOString();
}
export function numberOrNull(raw) {
  if (raw === null || raw === undefined || String(raw).trim() === "") return null;
  assert(typeof raw === "number" || typeof raw === "string", "数値の型が不正です");
  const text = String(raw).trim().replace(/,/g, "");
  if (/^\d[\d,.]*\s*[〜~–-]\s*\d/.test(String(raw).trim())) return null;
  assert(/^\d+(?:\.\d+)?$/.test(text) && Number.isFinite(Number(text)) && Number(text) <= Number.MAX_SAFE_INTEGER, "観測数値が不正です");
  return Number(text);
}
export function unknown(reason = "NOT_OBSERVED") {
  return { value: null, evidenceType: "UNKNOWN", availability: "NOT_AVAILABLE", reason, evidenceRefs: [] };
}
export function freshness(source, asOf, policy = {}) {
  assert(policy && typeof policy === "object" && !Array.isArray(policy) && Object.keys(policy).every((key) => ["maxRetrievedAgeDays", "maxPeriodAgeDays"].includes(key)), "freshness policyの項目が不正です");
  const days = (v) => v === null ? null : Math.floor((Date.parse(asOf) - Date.parse(v)) / 86400000);
  const retrievedAgeDays = days(source.retrievedAt);
  const periodAgeDays = source.periodEnd ? Math.floor((Date.parse(`${asOf.slice(0, 10)}T00:00:00Z`) - Date.parse(`${source.periodEnd}T00:00:00Z`)) / 86400000) : null;
  let status = "FRESHNESS_NOT_EVALUATED";
  if (source.retrievedAt && Date.parse(source.retrievedAt) > Date.parse(asOf)) status = "AFTER_AS_OF";
  else if (source.periodEnd && source.periodEnd > asOf.slice(0, 10)) status = "PERIOD_IN_PROGRESS";
  else if (policy.maxRetrievedAgeDays !== undefined || policy.maxPeriodAgeDays !== undefined) {
    for (const v of Object.values(policy)) assert(Number.isInteger(v) && v >= 0, "freshness policyは非負整数です");
    const absent = (policy.maxRetrievedAgeDays !== undefined && retrievedAgeDays === null) || (policy.maxPeriodAgeDays !== undefined && periodAgeDays === null);
    status = absent ? "UNKNOWN" : ((policy.maxRetrievedAgeDays !== undefined && retrievedAgeDays > policy.maxRetrievedAgeDays) || (policy.maxPeriodAgeDays !== undefined && periodAgeDays > policy.maxPeriodAgeDays)) ? "STALE" : "WITHIN_POLICY";
  }
  return { status, retrievedAt: source.retrievedAt, periodEnd: source.periodEnd, retrievedAgeDays, periodAgeDays, periodAgeBasis: "AS_OF_UTC_CALENDAR_DATE_NOT_SOURCE_END_TIMESTAMP", policy };
}

/** EvidenceRecord retains per-value provenance. A source absence never supplies a zero. */
export function evidence(source, metricOrClaim, value, { evidenceType = "FACT", availability, reason = null, rawValue = null, unit = null, scope = source.scope, recordReference = null } = {}) {
  assert(EVIDENCE_TYPES.includes(evidenceType), "evidenceTypeが不正です");
  const empty = value === null || value === undefined;
  const item = {
    metricOrClaim, value: empty ? null : value, rawValue, unit,
    evidenceType: empty ? "UNKNOWN" : evidenceType,
    availability: availability ?? (empty ? "NOT_AVAILABLE" : "OBSERVED"), reason: reason ?? (empty ? "NOT_OBSERVED" : null),
    sourceId: source.sourceId, sourceReference: source.sourceReference, sourceFileHash: source.sourceFileHash,
    sourceRecordReference: recordReference, provider: source.provider,
    retrievedAt: source.retrievedAt, parsedAt: source.parsedAt,
    periodStart: source.periodStart, periodEnd: source.periodEnd, timezone: source.timezone,
    country: source.country, language: source.language, grain: source.grain, scope,
    isSynthetic: source.isSynthetic, freshness: source.freshness,
  };
  // File hash/record position are provenance, not semantic identity. Reordered/repeated
  // exports cannot manufacture additional evidence, but differing periods/scopes remain.
  const identity = { provider: item.provider, metricOrClaim, value: item.value, rawValue, unit, evidenceType: item.evidenceType,
    availability: item.availability, reason: item.reason, periodStart: item.periodStart, periodEnd: item.periodEnd,
    timezone: item.timezone, country: item.country, language: item.language, grain: item.grain, scope, isSynthetic: item.isSynthetic, retrievedAt: item.retrievedAt };
  return { evidenceId: hash(identity), ...item };
}

export function validateManifest(manifest) {
  assert(manifest?.schemaVersion === SCHEMA_VERSION && Array.isArray(manifest.sources) && manifest.sources.length > 0, "manifestにはschemaVersion=1と1つ以上の明示sourceが必要です");
  assert(!manifest.purpose || manifest.purpose === "AFFILIATE_MONETIZATION", "このmanifestはAffiliate Monetization専用です");
  const ids = new Set();
  for (const source of manifest.sources) {
    assert(/^[a-zA-Z0-9_-]+$/.test(source.sourceId ?? "") && !ids.has(source.sourceId), "sourceIdが不正/重複です");
    ids.add(source.sourceId);
    assert(SOURCE_TYPES.includes(source.sourceType), "未対応のsourceTypeです(API/native noteは対象外)");
    assert(!source.purpose || source.purpose === "AFFILIATE_MONETIZATION", "NOTE_NATIVE_MONETIZATION等の別目的sourceは対象外です");
    assert(typeof source.path === "string" && source.path && !source.path.includes("://"), "ローカルsource pathが必要です");
    assert(typeof source.isSynthetic === "boolean", "isSyntheticを明示してください");
    if (source.evidenceType !== undefined) assert(EVIDENCE_TYPES.includes(source.evidenceType), "source evidenceTypeが不正です");
    if (source.retrievedAt != null) timestamp(source.retrievedAt, "retrievedAt");
    for (const key of ["periodStart", "periodEnd"]) if (source[key] != null) date(source[key], key);
    assert(!(source.periodStart && source.periodEnd) || source.periodStart <= source.periodEnd, "source期間が逆です");
  }
  assert(!manifest.links || Array.isArray(manifest.links), "linksは配列です");
  for (const link of manifest.links ?? []) {
    assert(link && typeof link === "object" && ((typeof link.keyword === "string" && link.keyword.trim()) || (typeof link.opportunityId === "string" && link.opportunityId.trim())), "linkにはkeywordまたはopportunityIdが必要です");
    for (const key of ["itemCodes", "seasonalityIds", "experimentIds", "decisionIds"]) if (link[key] !== undefined) assert(Array.isArray(link[key]) && link[key].every((v) => typeof v === "string" && v), `link.${key}は識別子配列です`);
    if (link.measurementIdMappings !== undefined) assert(Array.isArray(link.measurementIdMappings), "measurementIdMappingsは配列です");
  }
  assert(!manifest.freshnessPolicy || (typeof manifest.freshnessPolicy === "object" && !Array.isArray(manifest.freshnessPolicy)), "freshnessPolicyが不正です");
  for (const [id, policy] of Object.entries(manifest.freshnessPolicy ?? {})) {
    assert(ids.has(id), "freshnessPolicyのsourceIdが存在しません");
    assert(policy && typeof policy === "object" && !Array.isArray(policy) && Object.keys(policy).every((key) => ["maxRetrievedAgeDays", "maxPeriodAgeDays"].includes(key)), "freshness policyの項目が不正です");
    assert(Object.values(policy).every((v) => Number.isInteger(v) && v >= 0), "freshness policyは非負整数です");
  }
  return manifest;
}
