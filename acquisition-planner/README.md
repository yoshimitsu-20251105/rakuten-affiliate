# Acquisition Planner v1

Experiment Selectorの推薦0/1件を、既存LPへの流入計画へ変換するオフラインCLI。

```sh
node acquisition-planner/cli.js --manifest /private/planner-manifest.json --as-of 2026-10-22T12:00:00Z --run-id review-20261022
```

package.json追加・API・本文生成・公開・投稿・実験開始・台帳更新なし。事業KPIはApproved Revenue → Revenue → Conversions → EPC。READYは計画項目の充足であり、行動の許可ではない。

## 固定契約

`schemaVersion=1`, `outputType=ACQUISITION_PLAN_ONLY`。1推薦proposal → 1未登録experimentId案 → 1channel。推薦0件では `plans=[] / planStatus=BLOCKED / NO_SELECTOR_RECOMMENDATION`。Plannerは別候補を選ばない。

全てのrun/plan/note計画で次はfalse固定:

`canStartExperiment, canPublish, canPost, canModifyLP, canModifyCTA, canModifyAffiliateUrl, canModifyTracking`

`requiresStartTimeRevalidation=true`。枠予約なし。既存実験・LP・CTA・UTM・affiliate URL・tracking・Article Growth Freeze・daily・NOTE_NATIVE_MONETIZATIONを変更しない。

## 入力manifest

`schemaVersion=1,purpose,isSynthetic,inputs`。purposeは `AFFILIATE_MONETIZATION / AFFILIATE_NOTE_ACQUISITION`。native noteを拒否する。inputsの4項目は `{path,sha256?}`。Selector reportには期待sha256必須。全fileの原bytes hashを保存し、期待hashがあれば照合する。相対pathはそれぞれのmanifestを基準とする。UTF-8/BOM JSON対応。

| inputs key | 内容 |
|---|---|
| selectorReport | 元のEXPERIMENT_SELECTION_RECOMMENDATION_ONLY report |
| selectorInputManifest | 元Selectorの6入力manifest。必要ならhtmlSnapshotsを追加 |
| currentStateManifest | 現在の台帳・Learning・selectionContext・HTML・既知ID割当 |
| planningContext | policy・明示新experimentId案・承認済み変数・link証拠・手動確認 |

### 元Selectorの検証

元6入力のraw hash、Scanner/Scorer/ledger対応、asOf、selected proposal/candidateを検証し、元asOfで純粋Selector評価を再現する。ここでの評価は原reportの検証のみ。現在時点で新しい候補を比較・選定しない。

`selectorInputManifest.htmlSnapshots[]` は `{proposalId,targetLP,path,sha256?}`。元note検証等で使用した過去HTMLを明示する。欠落ならMANUAL_REVIEW_REQUIRED。現在HTMLを過去の証拠として代用しない。改変された原結果・hash/参照の不一致は入力エラー。

### 現在状態

currentStateManifestは `schemaVersion,purpose,isSynthetic,inputs,htmlSnapshots,identityIndex,orderEvidence?`。

- inputsには `experimentsSnapshot,learningLedger,selectionContext` の3参照を必須とする。
- current selectionContextは元Selectorと同じ契約。registry hash・確認時点・coverage・鮮度、分類reviewを保持する。推薦案の実験条件を変更しない。measurement証拠参照/historyReviewは現在の証拠を指定できるが、LP/channel/variables等の変更はBLOCKED。
- 現registryのraw hashに対応する可視Learning importと、原Learning履歴の保持を確認。Plannerから取込・修正しない。
- htmlSnapshotsは上記形式。現在のrepository HTMLを明示し、元固定LP hashと比較する。全channelでdriftはBLOCKED。
- identityIndexは `{coverage:'COMPLETE'|'UNKNOWN',scope:'KNOWN_AFFILIATE_IDENTIFIERS',observedAt,maxAgeDays,sourceReference,entries:[]}`。entriesはexperimentId/candidateId/channel/contentUnit/variant/targetLP/materialHash、既知UTM/ID割当を持つ。未登録の外部活動がないという保証ではない。不明・古い範囲はreview。
- orderEvidenceは任意で `{csv:{path,sha256},metadata:{path,sha256?}}`。既存Funnel parserで原CSVをread-only検証し、measurement_idが実recordにあることを確認する。metadataはFunnel order adapterと同じaccount/月/currency/timezone/snapshotAsOf/retrievedAt/coverage/filters/inputMode/isSynthetic等。取込ledgerを書かず、金融集計しない。

最新のconcurrency/retry/counterEvidence、LP hash、affiliate_click、証拠有効期間、Selectorと評価証拠の鮮度を再確認する。古い推薦を無条件にREADYにしない。

### planningContextと元実験案

policyは `policyId,version:'acquisition-planner-v1',policyHash,configuredBy,configuredAt,confirmationReference,applicablePeriod,maxSelectorAgeDays,maxProofAgeDays,providerPolicy`。policyHashはmodel.jsのPOLICY_HASH。期間/年齢は明示policyで、現在時刻による暗黙補完なし。

`selectedProposalId` と `plan={experimentId,candidateId,channel,targetLP,...protocol}` を指定する。experimentIdは新規の明示案。未指定nullはreview、既存実験ID再利用はBLOCKED。登録・予約・RUNNING化しない。

元Selector proposalの `variables.acquisition` に承認済みprotocolを置く。

```text
contentUnit, variant, contentPurpose, contentPattern, titlePattern, ctaPattern,
fixedVariables, changedVariable, requiredMetrics, requiredTrafficGrain, attributionScope
```

planのprotocolは原案と一致必須。欠落をPlannerが創作せず、primaryMetricをrequiredMetricsから削除して計画条件を弱めない。

link型のcontentPurposeはAFFILIATE_LP_ACQUISITION、organicはEXISTING_LP_ORGANIC_OBSERVATION。requiredTrafficGrainはCAMPAIGN_CONTENT / ORGANIC_PAGE_PERIOD。attributionScopeはMEASUREMENT_ID_ONLY / EXPERIMENT_CHANNEL / LP_ONLY。

changedVariableは `{name,from,to,reason}`。link型はchannel/contentPattern/titlePattern/ctaPatternの承認済み1変数、organic観察のみはname/from/to=null。これは将来の検証変数の記録で、既存CTA等の編集ではない。from不明はnull。固定LP/hash/offerは原参照を保持する。

## UTMとidentity

- note: source=note / medium=referral / purpose=AFFILIATE_NOTE_ACQUISITION。
- X: source=x / medium=social / purpose=AFFILIATE_MONETIZATION。
- campaign=`amv2__<experimentId>__<channel>`。
- content=`<contentUnit>__<variant>`。
- organic_searchのsource/medium/campaign/contentは全てnull、NOT_APPLICABLE_ORGANIC。plannedAcquisitionURLは正規LPのまま。内部リンク・検索結果・canonicalへUTMを追加しない。

planIdはexperimentId/candidateId/channel/contentUnit/variantのcanonical SHA-256で決定する。IDは小文字ASCIIの英数字と単一hyphen/underscoreを受け付け、予約区切り `__` を禁止。切詰め・無断小文字化・時刻suffix・random fallbackなし。同じキーの異なる条件、別scopeへのexperimentId再利用、UTM衝突はBLOCKED。同じidentity/materialの再計画はidempotent。

runIdは入力hash/asOf/policyから決定するか明示入力する。CLIはas-of必須。generatedAt/codeCommit/run保存名は計画identityやUTMを変えない。randomUUIDはprivate一時保存directory名だけに使い、plan/proposal/UTM識別子へ使わない。同runの保存は上書きしない。

## 楽天measurement IDの三状態

| affiliateMeasurementIdStatus | 意味 |
|---|---|
| VERIFIED_EXISTING | 明示provider policyと、保存HTMLの実anchor href・ID parameter・hash・account・有効期間の接続証拠が揃う |
| PROPOSED | proposedIdだけがあり、実link接続証拠が揃わない |
| UNKNOWN | 接続・割当を確認できない |

planningContext.measurementIdは `{proposedId,binding}`。bindingはmeasurementId/accountScopeId/experimentId/candidateId/channel/targetLP/pageHash/affiliateLink/confirmedBy/At/validPeriod/exclusivity/evidenceReference/isSynthetic。

providerPolicyはaccountScopeId、**確認済み**measurementParameter、allowedHostnames、confirmedBy/At、evidenceReference、validPeriod。コードが楽天parameter名や利用制約を推測しない。v1は明示されたafl.rakuten.co.jp系のHTTPS linkのみ確認し、短縮URL/redirect/JS実行を解決しない。

実ID欄affiliateMeasurementIdに提案だけのIDを入れない。実IDがVERIFIED_EXISTINGでも、異なる提案IDへの切替はTRACKING_CHANGE_REQUIRED/BLOCKED。共有IDなのにEXPERIMENT_CHANNEL scopeを要求した場合や、既知の独占割当と競合する場合もBLOCKED。

**FACTの帰属根拠**には、接続証拠に加えて、同じaccount/ID・適用期間の原CSV recordが必要。両者が揃う場合だけ `attributionEvidenceType=FACT / CSV_ID_AND_LINK_OBSERVED`。これはID単位での観測と保存link接続の証拠であり、過去のclick cohort・channel因果効果の証明ではない。

recordsは既存adapterの原status、PENDING/APPROVED/CANCELLED/UNKNOWN、commissionAmount(rewards)、merchandiseSalesAmount(amount)、通貨・取得時点・期間を維持する。CSVの0行や別ID/accountを新実験0円にしない。Revenue/Approved Revenue/Conversions/EPC/channelRevenue/experimentRevenueをPlannerで集計・推測配分せずnullを維持する。

## VERIFIED・鮮度・状態

noteはexact LP、現在HTML hash、GA4 property、affiliate_click send/receipt evidence、QA、検証者/時刻、validity/観測期間を既存Funnel/Learning validatorで再検証する。現在NOT_VERIFIED/NOT_IMPLEMENTED/失効/証拠不足なら必ずBLOCKED。新proof登録後に古いproofへ戻して通さない。

計画の観測期間は原proposal.scope.periodで明示できる。指定時はproof期間への包含も確認。公開・開始前に再検証が必要であり、将来の有効性を保証しない。

現在のgroup別concurrencyはSelectorの既存純粋関数で確認する。明示初期上限1。上限未設定/未知RUNNINGはreview、満杯はBLOCKED。非収益実験を一律にcountしない。同じLP/IDへの干渉は別gate。FAILEDをKILLや一律除外へ変換せず、現在Learningのretry三状態・反証を確認する。

TRAFFIC_GRAIN / CHANNEL_HANDOFFの確認はchecklistConfirmationsへ記録する。status、exact LP/channel/pageHash/proposalId/policyHash、reviewer/時刻、sourceReferenceが必須。GA4チャネルグループだけをcampaign/content計測完備とみなさない。未知はMANUAL_REVIEW_REQUIRED、不可はBLOCKED。

Funnel v1のクリックcohort結合が未実装のため、EPCを必須にした案はBLOCKED。非0conversion粒度はPARTIALLY_VERIFIEDのため、必須conversionはreview。affiliate_click VERIFIEDだけで両者を計測完備にしない。

優先順位: BLOCKED > MANUAL_REVIEW_REQUIRED > READY。全理由をsource/pointer付きで保存する。未観測の将来Revenueそれ自体は、既存測定経路が確認できた初回実験を禁止する理由にはしない。

## 出力・private保存

plan.json/report.md/run-metadata.jsonをignored `reports/acquisition-planner/<runId>/` に保存。directory0700/files0600。symlink、同run上書き、docs/strategy等への出力は拒否。--private-dirはOS専用一時directoryのみ。

planは全要求fieldとidentity、元Selector参照、現在measurement proof、retry/concurrency/counterEvidence、三状態ID、unknowns、blockingReasons、evidenceRefsを保持する。値のFACT/ESTIMATE/HYPOTHESIS/UNKNOWNを混同しない。

noteはaffiliateNotePostPlanにexperimentId/channel/LP/UTM/ID/status/patternを保持する。publishedAt/postUrlとimpressions/views/likes/outboundLPClicksは未記録ならnull。実投稿や既存note対Xへ後付けしない。

publishChecklistはPLANとPRE_PUBLISH/POST_PUBLISHを分ける。後者はPENDING_EXECUTIONで、計画のREADYを公開完了にしない。JSON/Markdownはprivate資料だけ。

## 検証・保護・rollback

```sh
node --test keyword-research/test/acquisition-planner-*.test.js
npm test
npm run strategy:validate
node check-links.js
```

新規16ファイルのみ。既存716 tracked files、package.json、lockfile、既存tests/5 modules、docs/408記事、LP/CTA/UTM/affiliate URL、実験、Freeze、daily、Native noteは変更しない。

fixturesは全て架空データ。非synthetic契約分岐を試す加工データも、実市場・非0楽天実CSV検証済みとは記録しない。

rollbackは新CLI利用停止と追加commitのrevert。private plan・証拠を残す。実験や公開資産の状態巻き戻しは不要。
