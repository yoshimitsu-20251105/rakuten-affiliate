# senior-cat-food affiliate_click VERIFIED review — 2026-11-14

This is a new review record. It does not overwrite the existing 2026-11-10 review. The final pre-application audit returned `FINAL_APPLICATION_REVIEW = APPROVE`.

## Formal status

- Target LP: `https://yoshimitsu-20251105.github.io/rakuten-affiliate/rankings/senior-cat-food.html`
- `affiliateClickMeasurementStatus = VERIFIED`
- `verifiedAt = 2026-11-14T14:02:01+09:00`
- `verifiedBy = repository-owner-with-claude-code-audit`
- `verifiedPageHash = ea2ab4e8a27455128dc1b12779d3ae33a26d2432e8a967f41e791a2d6bf95917`
- `ga4PropertyReference = properties/550074703`
- `expectedEventName = affiliate_click`
- Applicable period: `2026-11-14` through `2026-12-12`, inclusive.
- Approval day 2026-11-14 is not business-KPI eligible. Complete-day business evaluation is 2026-11-15 through 2026-12-12.

This review authorizes only the measurement status record. It does not authorize another LP rollout, Selector execution, experiment start, AUTO_PUBLISH changes, NOTE_NATIVE_MONETIZATION changes, GA4 settings changes, or affiliate-link changes.

## E1 — SEND / STANDARD CLICK

User-observed production Chrome Network evidence for a single Rakuten CTA action:

- `affiliate_click`: 2026-11-10 17:35:40 JST, POST, HTTP 204.
- Measurement ID: `G-5FQMHQ5X6W`.
- Link domain: `hb.afl.rakuten.co.jp`.
- Link class: `cta-button`.
- QA run: `senior-cat-20261110-live-01`.
- Standard outbound `click`: 2026-11-10 17:35:46 JST, POST, HTTP 204.

Judgment: **SEND = PASS / STANDARD CLICK = PASS**.

## E2 — GA4 RECEIVE / QA RUN BINDING / QA EXCLUSION

Read-only standard GA4 Data API audit completed after 2026-11-12 18:12 JST.

- Property: `550074703`.
- Record/property reference form: `properties/550074703`.
- Target LP: `/rakuten-affiliate/rankings/senior-cat-food.html`.
- QA marker: `amv2_qa=1`.
- QA run: `senior-cat-20261110-live-01`.
- The exact LP and QA marker/run showed `affiliate_click = 1` and `click = 1`.

For the exclusion comparison, the audit reconstructed the same conditions defined by `seniorCatBusinessPageFilter`; it did not execute the repository function itself. The QA row was present in the QA-scoped query and absent from the reconstructed business-exclusion query.

Judgment: **GA4 RECEIVE = PASS / QA RUN BINDING = PASS / QA EXCLUSION = PASS**.

Scope limit: this PASS applies to repository business queries using the corresponding exclusion conditions. It does **not** assert removal from GA4 standard UI, arbitrary Data API queries, or unfiltered exports.

`receivedAt = 2026-11-12T18:13:00+09:00`.

## E3 — EXACT PROPERTY

Data API observation and the user-confirmed GA4 Admin screen were matched by stream ID:

`property 550074703 → stream 15448656688 → measurement ID G-5FQMHQ5X6W`.

The claim does not depend on the property having only one stream.

Judgment: **EXACT PROPERTY = PASS**.

## E4 — PAGE HASH / FINAL REVALIDATION

Read-only revalidation on 2026-11-14 confirmed:

- Production LP HTTP 200.
- Production SHA-256: `ea2ab4e8a27455128dc1b12779d3ae33a26d2432e8a967f41e791a2d6bf95917`.
- Master copy had the same hash.
- Relevant senior-cat affiliate measurement code was unchanged from the audited implementation.
- Measurement ID remained `G-5FQMHQ5X6W`.
- Four Rakuten CTAs remained on `hb.afl.rakuten.co.jp`, all with `data-item-rank`.

Judgment: **PAGE HASH = PASS / FINAL_REVALIDATION = PASS**.

Known unknown: GA4 data-filter settings after the 2026-11-12 audit remain **UNKNOWN**.

## E5 — MANUAL QA CONTAMINATION

The senior-cat LP had markerless manual observations on 2026-11-10 around:

- 09:46–09:55 JST.
- 17:21 JST.

Therefore:

- 2026-11-10 is entirely business-KPI-ineligible for this LP.
- `MANUAL_EXCLUSION_REQUIRED` remains in force.
- Do not subtract a guessed single event or otherwise reconstruct a clean business total from that day's aggregate.
- The marker-based QA exclusion PASS must not be generalized to `CONFIRMED_CLEAN` for all 2026-11-10 data.
- No VERIFIED status is applied retroactively to October, 2026-11-10, or any pre-approval period.

## Existing fail-closed gates

Existing behavior remains authoritative:

- Current page hash != `verifiedPageHash` → NOT_VERIFIED / PAGE_OR_PROPERTY_MISMATCH.
- Current property reference != `properties/550074703` → NOT_VERIFIED / PAGE_OR_PROPERTY_MISMATCH.
- Requested period outside the applicable period → NOT_VERIFIED.

Property references used by analysis metadata, Planner measurement context, and CLI `--property` must use the exact `properties/550074703` string when this record is evaluated.

## History

The prior files remain untouched:

- `strategy/measurement-reviews/2026-11-10-senior-cat-affiliate-click.json`
- `strategy/measurement-reviews/2026-11-10-senior-cat-affiliate-click.md`

This record does not itself start a monetization experiment. Selector/Planner use remains a separate decision and, where required by the existing architecture, separate Learning-ledger ingestion.
