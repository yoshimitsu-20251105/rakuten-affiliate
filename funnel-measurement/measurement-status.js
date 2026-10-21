import { assert, assertDate, assertTimestamp, canonicalLP, jstDate, MEASUREMENT_STATUSES } from "./model.js";

/** LPMeasurementRecord. Validation does not send events or register an experiment. */
export function validateMeasurementRecord(record) {
  assert(record && typeof record === "object", "LPMeasurementRecordが必要です");
  canonicalLP(record.targetLP);
  assert(MEASUREMENT_STATUSES.includes(record.affiliateClickMeasurementStatus), "affiliateClickMeasurementStatusが不正/未指定です");
  if (record.affiliateClickMeasurementStatus !== "VERIFIED") return record;
  assert(typeof record.evidenceId === "string" && record.evidenceId.trim(), "VERIFIEDにはevidenceIdが必要です");
  assertTimestamp(record.verifiedAt, "verifiedAt");
  assert(typeof record.verifiedBy === "string" && record.verifiedBy.trim(), "VERIFIEDにはverifiedByが必要です");
  assert(/^[a-f0-9]{64}$/.test(record.verifiedPageHash ?? ""), "検証時HTMLのSHA-256が必要です");
  assert(typeof record.ga4PropertyReference === "string" && record.ga4PropertyReference.trim(), "GA4 property参照が必要です");
  assert(record.expectedEventName === "affiliate_click", "affiliate_clickの検証証拠が必要です");
  const evidence = record.evidence;
  assert(evidence && canonicalLP(evidence.targetLP) === record.targetLP, "証拠のtargetLPが一致しません");
  assert(evidence.eventName === "affiliate_click" && evidence.ga4PropertyReference === record.ga4PropertyReference, "証拠のイベント/GA4 propertyが一致しません");
  assert(evidence.sent === true && evidence.received === true, "送信・GA4受信の両方の確認が必要です");
  for (const key of ["sendReference", "receiveReference", "qaEventReference"]) assert(typeof evidence[key] === "string" && evidence[key].trim(), `${key}が必要です`);
  for (const key of ["sentAt", "receivedAt"]) assertTimestamp(evidence[key], key);
  assert(Date.parse(evidence.sentAt) <= Date.parse(evidence.receivedAt) && Date.parse(evidence.receivedAt) <= Date.parse(record.verifiedAt), "検証証拠の時系列が不正です");
  assertDate(record.applicablePeriod?.start, "applicablePeriod.start");
  assertDate(record.applicablePeriod?.end, "applicablePeriod.end");
  assert(record.applicablePeriod.start <= record.applicablePeriod.end, "検証適用期間が逆です");
  // Same-day NEW starts are allowed, but a whole-day historical aggregate cannot be
  // verified retroactively for hours before the proof was collected.
  assert(record.applicablePeriod.start >= jstDate(record.verifiedAt), "検証済み期間はverifiedAtの日以降にしてください(過去への適用不可)");
  if (record.invalidatedAt) assertTimestamp(record.invalidatedAt, "invalidatedAt");
  return record;
}

export function measurementAvailability(record, { targetLP, currentPageHash, ga4PropertyReference, period = null, at = new Date().toISOString() }) {
  if (!record) return { status: "NOT_VERIFIED", reason: "NO_MEASUREMENT_RECORD" };
  validateMeasurementRecord(record);
  canonicalLP(targetLP);
  if (record.targetLP !== targetLP) return { status: "NOT_VERIFIED", reason: "LP_MISMATCH" };
  if (record.affiliateClickMeasurementStatus !== "VERIFIED") return { status: record.affiliateClickMeasurementStatus, reason: "MEASUREMENT_NOT_VERIFIED" };
  assertTimestamp(at, "at");
  if (Date.parse(record.verifiedAt) > Date.parse(at) || (record.invalidatedAt && Date.parse(record.invalidatedAt) <= Date.parse(at))) return { status: "NOT_VERIFIED", reason: "EVIDENCE_NOT_CURRENT" };
  if (currentPageHash !== record.verifiedPageHash || ga4PropertyReference !== record.ga4PropertyReference) return { status: "NOT_VERIFIED", reason: "PAGE_OR_PROPERTY_MISMATCH" };
  if (period) {
    assertDate(period.start, "period.start"); assertDate(period.end, "period.end");
    if (period.start <= jstDate(record.verifiedAt) || period.start < record.applicablePeriod.start || period.end > record.applicablePeriod.end || period.start > period.end ||
        (record.invalidatedAt && jstDate(record.invalidatedAt) <= period.end)) return { status: "NOT_VERIFIED", reason: "PERIOD_NOT_VERIFIED" };
  } else {
    // Start gate must use an evidence window covering the proposed start, not only an old proof.
    const day = jstDate(at);
    if (day < record.applicablePeriod.start || day > record.applicablePeriod.end) return { status: "NOT_VERIFIED", reason: "START_OUTSIDE_VERIFIED_PERIOD" };
  }
  return { status: "VERIFIED", reason: null, evidenceId: record.evidenceId };
}

export function assertNewAffiliateNoteExperimentAllowed({ purpose, experimentId, measurementRecord, ...context }) {
  assert(purpose === "AFFILIATE_NOTE_ACQUISITION", "このgateは新規Affiliate note専用です");
  assert(typeof experimentId === "string" && experimentId.trim(), "experimentIdが必要です");
  const result = measurementAvailability(measurementRecord, context);
  assert(result.status === "VERIFIED", `新規Affiliate note実験開始不可: ${result.status}/${result.reason}`);
  return { allowed: true, experimentId, affiliateClickMeasurementStatus: "VERIFIED", evidenceId: result.evidenceId };
}
