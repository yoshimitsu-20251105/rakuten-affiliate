import { createHash } from "node:crypto";

export const SCHEMA_VERSION = 1;
export const MEASUREMENT_STATUSES = ["VERIFIED", "NOT_VERIFIED", "NOT_IMPLEMENTED"];
export const hash = (value) => createHash("sha256").update(value).digest("hex");

/**
 * @typedef {Object} ImportBatch
 * @property {1} schemaVersion
 * @property {string} importId
 * @property {string} sourceFileHash SHA-256 of the original bytes, including BOM
 * @property {string} normalizedContentHash Order-independent multiset hash (duplicates retained)
 * @property {string} accountScopeId Opaque, non-secret provider account reference
 * @property {string} reportLabel YYYY.MM
 * @property {string} periodStart
 * @property {string} periodEnd Requested report month, NOT a finalized period
 * @property {string} snapshotAsOf Time explicitly supplied by the operator
 * @property {string} retrievedAt Actual retrieval time, distinct from import time
 * @property {string} importedAt
 * @property {string|null} sourceGeneratedAt
 * @property {"JPY"} currency
 * @property {"Asia/Tokyo"} timezone Explicitly confirmed by the operator, not inferred from CSV
 * @property {"COMPLETE"|"PARTIAL"} coverage
 * @property {boolean} isSynthetic Synthetic and real ledgers cannot be combined
 *
 * @typedef {Object} PerformanceRecord
 * @property {string} recordKey Import-local source hash + CSV line, NOT a transaction identity
 * @property {string} sourceStatus Original, unmodified status cell
 * @property {"PENDING"|"APPROVED"|"CANCELLED"|"UNKNOWN"} approvalStatus
 * @property {number|null} commissionAmount JPY integer from rewards, never from amount/rate
 * @property {number|null} merchandiseSalesAmount JPY integer from amount
 * @property {string|null} measurementId Observed in this source record only
 * @property {null} conversionCount Nonzero row grain remains unverified
 * @property {"PARTIALLY_VERIFIED"} conversionValidationStatus
 *
 * @typedef {Object} MetricObservation
 * @property {number|null} value Missing data is null, not zero
 * @property {string} availability
 * @property {string|null} reason
 * @property {string} evidenceType
 *
 * @typedef {Object} LPMeasurementRecord
 * @property {string} targetLP Canonical HTTPS URL without UTM/query
 * @property {"VERIFIED"|"NOT_VERIFIED"|"NOT_IMPLEMENTED"} affiliateClickMeasurementStatus
 * @property {string} [evidenceId]
 * @property {string} [verifiedAt]
 * @property {string} [verifiedPageHash] SHA-256 of verified HTML bytes
 * @property {Object} [evidence] Matching target/event/property, send + receive proof, QA reference
 */

export function assert(condition, message) {
  if (!condition) throw new Error(message);
}

export function assertTimestamp(value, name) {
  assert(typeof value === "string" && /^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value)), `${name}: timezone付き日時が必要です`);
  const date = value.slice(0, 10);
  assertDate(date, name);
  return value;
}

export function assertDate(value, name) {
  const epoch = typeof value === "string" ? Date.parse(`${value}T00:00:00Z`) : NaN;
  assert(typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(epoch) && new Date(epoch).toISOString().slice(0, 10) === value, `${name}: 実在するYYYY-MM-DDが必要です`);
  return value;
}

export function jstDate(value) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));
}

export function canonicalLP(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error("targetLP: 正規HTTPS URLが必要です"); }
  assert(url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash, "targetLP: クエリ・fragment・認証情報のないHTTPS URLが必要です");
  return url.href;
}

/** MetricObservation: value is never substituted with zero for missing data. */
export function observation(value, availability = "OBSERVED", reason = null, context = {}) {
  assert(value === null || (typeof value === "number" && Number.isFinite(value)), "metric valueが不正です");
  return { value, availability, reason, evidenceType: value === null ? "UNKNOWN" : "FACT", ...context };
}

export function sumSafe(values) {
  const sum = values.reduce((total, value) => {
    assert(Number.isSafeInteger(value), "金額は安全な整数である必要があります");
    assert(Number.isSafeInteger(total + value), "金額合計が安全な整数範囲を超えています");
    return total + value;
  }, 0);
  return sum;
}
