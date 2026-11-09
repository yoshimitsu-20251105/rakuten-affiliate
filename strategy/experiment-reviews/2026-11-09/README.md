# 2026-11-09 experiment closure and re-selection

Base: `0376dd712783b7c112f5065f2c7bba05a4b7a6a0` (`master`). This review is separate from Publishing Safety Layer PR #39. It changes no publishing configuration, production module, LP, article, affiliate URL or workflow. No experiment is started.

| Experiment | Final status / result | Decision | Primary evidence |
|---|---|---|---|
| 10/13 grain-free-dog note vs X | INCONCLUSIVE | HOLD | 10/13–10/27: note 1 session, X 1 session; both below 20 |
| 10/05 senior-cat-food | INCONCLUSIVE | IMPROVE | By 11/04: 6 GSC impressions; above falsification=0, below success=10 |
| 10/05 grain-free-dog-food | FAILED | IMPROVE | By 11/04: user-confirmed no search exposure; URL not known to Google |
| 10/05 domestic-additive-free-dog-treats | FAILED | IMPROVE | By 11/04: user-confirmed no search exposure; URL not known to Google |
| 9/10 grain-free-cat-food | FAILED (already closed 10/10) | IMPROVE | Preserve the existing 10/10 conclusion; current follow-up metrics unknown |

The current registry has zero RUNNING experiments; the monetization group is **0/1**. This becomes shared master state only after this branch is merged. A Learning entry alone does not release a slot.

The three SEO records on `feature/close-note-x-reselect` used STOPPED / INCONCLUSIVE / HOLD as an administrative pause when the audit was unavailable. Those were not conclusions from the predefined falsification condition. The user's dated audit confirmation now supplies reviewDate evidence; this branch uses that evidence and appends correction revisions. FAILED applies to the baseline SEO discovery hypothesis, never to market demand and never automatically to KILL.

## Evidence and missingness

- `evidence.json` stores results, counter evidence, falsification, decisions and learning separately. Audit retrieval: 2026-11-09 16:51 JST. GSC: 9/10–11/06; GA4: 9/10–11/08. These are acquisition ranges, not an assertion that every experiment uses the entire range.
- The supplied audit path is recorded, but the raw JSON is absent from this environment. Values are **user_verified**, not a newly executed API result; its source file hash remains null. New GA4 per-LP metrics, timezone and QA exclusions were not supplied and remain unknown.
- Senior-cat: primary 10/05–11/04 = 6 impressions. Post-period 11/05–11/06 = +3, excluded from the primary result. Broader audit total 9, clicks 0 and approximate average position 7.1 are not silently assigned to the primary period.
- The two other SEO reports have user-confirmed no exposure / NO_ROWS. This supports the predefined zero-exposure falsification only. GSC clicks and demand are not inferred as zero.
- Note/X `affiliate_click = null / NO_ROWS_RETURNED`. Platform link clicks are not affiliate clicks. No channel winner, LP, product or CTA verdict is issued.
- Official Rakuten 2026.10 snapshot: zero records and zero account-level conversions, commission Revenue, Approved Revenue and merchandise sales. `rewards` is commission; `amount` is merchandise sales. No account revenue is allocated to a candidate, LP or channel. Snapshot retrieval/as-of metadata is still unknown, so the snapshot is not represented as final monthly revenue.

## Append-only Learning

`learning-evidence.json` contains sealed evidence additions. `learning-review.json` is the actual Learning Engine review contract; `learning-append-receipt.json` records old/new ledger hashes, counts, parent revisions and preservation checks.

- Note/X learning: v5 supersedes v4; HOLD has CONDITIONAL retry and all four required conditions: a new acquisition method, evidence supporting 20 sessions per channel in 14 days, exact-LP VERIFIED click measurement, and available official Rakuten snapshots.
- Three SEO learnings: v2-audit supersedes the administrative v1. Imported legacy decisions are also corrected through revisions. Grain-free-cat receives a follow-up learning without altering its already closed registry record.
- All pre-existing private ledger records were retained byte-for-byte as objects. Full private ledger history, raw exports and runtime reports stay outside Git. Replaying these corrections needs the parent revisions named in the receipt; do not fabricate parents or overwrite the history on a new clone.
- Learning v1 conservatively flags multiple historical source snapshots as CONFLICT / SOURCE_CHANGED_REVIEW_REQUIRED. This review does not discard old snapshots or change the engine to force a recommendation.

## Re-selection

The saved run `isolated-closure-20261109-01` executes Scanner → Scorer → Learning import/report → Selector → Planner. `reselection-summary.json` contains a bounded comparison and SHA-256 references to the private outputs. It records the executing code commit and the exact registry hash separately, since the authorized data edits were uncommitted at execution time.

Scanner has three existing-LP candidates. Scorer keeps Observed Performance and Exploration separate; unattributable financial metrics and incomplete total scores remain null. There is no finalRank.

Selector: **0 recommendations**, `NO_EXPLICIT_PROPOSAL_DEFINED`. Exact verified Rakuten itemCode mappings were not available to define formal proposals. Planner: **BLOCKED / NO_SELECTOR_RECOMMENDATION**, zero plans. This is not a traffic or revenue ranking, nor a claim that the candidates passed every eligibility gate.

The preparation priority is **senior-cat-food** (HYPOTHESIS): it has the most recent supplied positive search exposure and an Indexed / index-allowed inspection. Senior-dog-pork and grain-free-cat-food have older saved GA4 traffic, mostly Direct, and need fresh scoped observation. No candidate is authorized to start. The shortest next step is to obtain senior-cat's current GA4 acquisition evidence, exact-LP affiliate_click send/receipt proof and verified offer/measurement-ID mapping, then submit one fully evidenced proposal to Selector.

Supporting tests distinguish a historical four-RUNNING fixture from the current registry and validate only the explicitly authorized lifecycle delta. Content-based asset guards accept normal generated date/expiry changes from older implementation baselines while still detecting Planner/Selector code, LP, CTA, affiliate-link and past experiment mutations. Safety Layer code is not part of this branch. Some test maintenance overlaps PR #39; keep the closure-specific guard when reconciling those test files during a later merge.
