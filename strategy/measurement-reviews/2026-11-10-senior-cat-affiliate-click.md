# senior-cat-food affiliate_click pilot

Implementation only on `rankings/senior-cat-food.html`. No other LP opts in. No deployment, experiment start or publication is performed by this change. AUTO_PUBLISH and NOTE_NATIVE_MONETIZATION are unchanged.

## Before / after

FACT (user-confirmed Network observation): standard outbound `click` reached `google-analytics.com/g/collect` with HTTP 204, `link_classes=cta-button`, `link_domain=hb.afl.rakuten.co.jp`, `outbound=true`. No `affiliate_click` send was observed. Observation time and GA4 receipt reference were not supplied.

FACT (repository): a legacy inline affiliate handler already existed. This change replaces it; it does not add a second sender. The GA4 loader, property measurement ID, config call, content, CTA labels, hrefs, targets and rel attributes remain byte-identical.

The replacement installs one delegated capture listener before the unchanged GA4 bootstrap. Exact path + exact HTTPS Rakuten affiliate hostname + CTA class are required. Reinitialization is ignored; the same event object is handled once. Separate rapid clicks remain separate events. Default navigation, propagation and the independent standard GA4 click are preserved.

| GA4 event / parameter | Source |
|---|---|
| event_name = affiliate_click | `gtag('event', 'affiliate_click', params)`; Network `en` |
| page_location | Actual current URL, including the QA marker when present |
| page_path | Actual pathname |
| link_url / link_domain / link_classes | Clicked CTA URL, exact hostname and class attribute |
| target_lp | This LP's existing canonical URL |
| affiliate_network | rakuten |
| item_rank / animal_type / selection_type / page_type | Existing explicit CTA attributes |

`item_code`, `shop_code`, `measurement_id`, `experiment_id` are omitted: current CTA attributes do not establish verified bindings. Affiliate URL tokens and `rafcid` are not repurposed as measurement IDs.

## QA isolation and missingness

Use `amv2_qa=1` and a unique opaque `amv2_qa_run`. Before GA4 config, the page sets `debug_mode=true`, `traffic_type=qa`, `qa_traffic=1`, and a valid supplied `qa_run_id`. This labels automatic page views / standard clicks as well as the custom event. Normal access receives no QA labels. No UTM or affiliate-link query is changed.

Labels alone do not prove exclusion from GA4's default UI or arbitrary exports. For this exact LP, all four repository GA4 queries exclude the marker through the built-in `pagePathPlusQueryString` dimension. No custom dimension registration or GA4 property/filter settings change is required. API rejection fails closed; it does not retry without the exclusion. Other LP query behavior is unchanged.

For this pilot, an empty GA4 result becomes `null / NO_ROWS_RETURNED`, not zero. Known partial observations are retained. Funnel and legacy CTR/judgment handling preserve null; absence cannot become 0% or a negative LP/CTA verdict. Existing records and historical metrics are not rewritten. Funnel's existing independent QA-cleanliness/completeness/VERIFIED gates remain required; this change does not automatically set `CONFIRMED_CLEAN`.

## Local verification and live QA boundary

Node tests cover parameters, exact host/path/CTA scope, invalid links, unknown IDs, reinitialization, per-event deduplication, distinct clicks, QA flags, all four query filters, API failure, null versus observed zero, CTR/judgment propagation and narrowly authorized protection changes.

Offline Chromium: 4 CTAs included in 5 clicks; 5 affiliate events, no duplicate after script reinstallation, nested target supported; ordinary links ignored; normal visitor has no QA flags. All network requests were intercepted. The independent standard-click observer was synthetic. **This is not actual GA4 SDK/Network/receipt verification. No synthetic 204 is used as proof.** Private result: `reports/measurement-qa/senior-cat-20261110/browser-offline.json`.

Current status is **NOT_VERIFIED / PENDING_LIVE_QA**. Neither this source file nor passing tests upgrades measurement status. The environment has no configured GA4 read credential, and the GA4 hosts are outside its current network allowlist. Existing Chrome/profile/logins are not used.

## Live QA after reviewed deployment

1. Confirm deployed HTML SHA-256 equals `candidatePageHash` in the companion JSON. Use a dedicated QA session and record the confirmed GA4 property, measurement ID, GA4 timezone, start time and QA run ID. Do not reuse the old experiment's observation period.
2. Open `https://yoshimitsu-20251105.github.io/rakuten-affiliate/rankings/senior-cat-food.html?amv2_qa=1&amv2_qa_run=senior-cat-20261110-live-01`. Use a new run suffix for a separate QA session. Keep the query marker during the test; do not navigate through other site pages in this production QA session. Negative-link tests are already exercised offline.
3. Clear Network log; filter `g/collect`; click one Rakuten CTA once. Inspect both query and POST/batched payloads. Confirm `en=click` and exactly one `en=affiliate_click` for that action, the correct `tid`, required event parameters, QA labels, and actual response status. `page_location` may be encoded as GA4's `dl`; do not require a redundant `ep.page_location` field. Count events in batched payloads rather than equating request count with event count.
4. In the same confirmed GA4 property, confirm one `affiliate_click` in DebugView / Realtime, or a scoped read-only Data API result after processing. Check the target page and QA run. An HTTP 204 alone is not GA4 ingestion proof. Empty rows, permission failure or unavailable dimensions remain UNKNOWN, not 0.
5. For Data API QA retrieval, use `eventName` + `pagePathPlusQueryString`, metric `eventCount`, exact `pagePath`, exact `eventName=affiliate_click`, and a query-string filter for this QA marker/run. Use the QA date in the property's timezone. Business queries must use the opposite marker exclusion, already applied by `seniorCatBusinessPageFilter`. Do not count QA observations as conversions, traffic success or EPC denominator. Do not subtract a guessed count from an unfiltered aggregate.
6. Save send/receipt references and timestamps privately, plus the HTML hash, exact target LP, GA4 property, QA run reference, exclusion evidence and validity period. Verify the business query excludes the QA event. If any evidence is missing, keep NOT_VERIFIED and QA cleanliness unconfirmed.
7. Only then prepare a VERIFIED candidate using the existing `LPMeasurementRecord` validator and start gate. Validity starts after actual verification; never apply it retroactively to October. This change does not update the registry to VERIFIED or authorize an experiment start. Do not roll out to other LPs before successful live QA.

Rollback: revert this pilot commit. It restores the original HTML handler and read-only query behavior. No analytics settings, publication settings, existing experiment conditions, or article data need reversal. After any tracking change, new verification evidence is required for the new HTML hash.
