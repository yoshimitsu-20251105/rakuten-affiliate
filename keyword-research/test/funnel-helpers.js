import { readFileSync } from "node:fs";
import { hash } from "../../funnel-measurement/model.js";

export const zeroBytes = readFileSync(new URL("../fixtures/funnel-order-zero.csv", import.meta.url));
export const targetLP = "https://example.test/rankings/test.html";
export const html = "<!doctype html><title>SYNTHETIC QA</title>";
export const pageHash = hash(html);
export const meta = (overrides = {}) => ({
  reportLabel: "2026.10", accountScopeId: "synthetic-account", currency: "JPY", timezone: "Asia/Tokyo",
  coverage: "COMPLETE", filters: {}, dateBasis: "OCCURRENCE_DATE", inputMode: "SNAPSHOT",
  sourceReference: "anonymized-format-fixture-not-original-order.csv",
  snapshotAsOf: "2026-10-20T09:00:00+09:00", retrievedAt: "2026-10-20T09:01:00+09:00",
  isSynthetic: true, ...overrides,
});
export function recordsBytes(records) {
  const quote = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  return Buffer.from(zeroBytes.toString("utf8") + records.map((r) => [r.date ?? "2026/10/15", r.rewards ?? "100", "1.0", r.amount ?? "10000", "synthetic genre", "synthetic shop", r.item ?? "synthetic item", r.status ?? "0", "SYNTHETIC_LINK", "SYNTHETIC_DEVICE", r.id ?? "synthetic-note"].map(quote).join(",")).join("\n") + "\n");
}
export function verified(overrides = {}) {
  return {
    targetLP, affiliateClickMeasurementStatus: "VERIFIED", evidenceId: "synthetic-evidence",
    verifiedAt: "2026-09-30T03:00:00Z", verifiedBy: "synthetic-test", verifiedPageHash: pageHash,
    ga4PropertyReference: "synthetic-property", expectedEventName: "affiliate_click",
    applicablePeriod: { start: "2026-10-01", end: "2026-10-31" },
    evidence: { targetLP, eventName: "affiliate_click", ga4PropertyReference: "synthetic-property", sent: true, received: true,
      sentAt: "2026-09-30T02:58:00Z", receivedAt: "2026-09-30T02:59:00Z", sendReference: "synthetic-send", receiveReference: "synthetic-receive", qaEventReference: "synthetic-QA" },
    ...overrides,
  };
}
export const analytics = () => ({
  runId: "synthetic-ga4-run", requestedPeriod: { from: "2026-10-01", to: "2026-10-20" },
  pages: [{ pageUrl: targetLP, ga4: { status: "OK", sessions: 30, screenPageViews: 40, affiliateClickEventCount: 20,
    byTrafficSource: [{ channel: "Referral", sessions: 30, screenPageViews: 40 }], affiliateClickByTrafficSource: [{ channel: "Referral", eventCount: 20 }] },
    searchConsole: { status: "OK", impressions: 1, clicks: 0 }, urlInspection: { status: "OK", indexStatus: "PASS" } }],
});
export const analyticsMeta = () => ({ retrievedAt: "2026-10-23T00:00:00Z", sourceReference: "synthetic-saved-report", ga4PropertyReference: "synthetic-property", timezone: "Asia/Tokyo", dataCompleteThrough: "2026-10-20", qaExclusionStatus: "CONFIRMED_CLEAN" });
