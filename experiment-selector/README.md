# Experiment Selector v1

保存済みの市場候補・評価・実験履歴から、次に人が検討する実験案を **0件または1件推薦する** オフラインCLI。事業KPIは Approved Revenue → Revenue → Conversions → EPC の順。推薦数・記事数は成功KPIではない。

```sh
npm run experiment:select -- --manifest /private/selection-inputs.json --run-id review-20261022 --as-of 2026-10-22T06:00:00Z
```

新規APIアクセス、台帳更新、実験の開始・停止、SCALE/KILL、生成・公開・投稿・通知・予約は行わない。入力moduleを起動・再取込・再採点せず、純粋validatorと比較・履歴関数を再利用する。`canStartExperiment=false`、`requiresStartTimeRevalidation=true` は常に固定。

## 入力契約

manifestは `schemaVersion=1`, `purpose=AFFILIATE_MONETIZATION` または `AFFILIATE_NOTE_ACQUISITION`, `isSynthetic` を必須とする。`inputs` の次の6項目に `{path, sha256?}` を指定する。相対pathはmanifest基準。`sha256` は任意の事前照合値で、未指定でも実bytesのhashを必ず計算・保存する。

| input | 契約 |
|---|---|
| scannerReport | `MARKET_CANDIDATES_ONLY`, schemaVersion=1 |
| scorerReport | `OPPORTUNITY_ASSESSMENTS_ONLY`, schemaVersion=1 |
| learningReport | `EXPERIMENT_LEARNING_REVIEW_ONLY`, schemaVersion=1 |
| learningLedger | Learning v1の5コレクションを持つledger |
| experimentsSnapshot | 現在の全登録Affiliate実験の `{items:[...]}` snapshot |
| selectionContext | 下記policy・registry確認・分類・明示実験案 |

UTF-8/BOM JSON。原file SHA-256、Scanner runId/hash、Scorerの固定配点・成分・total・比較条件、Learning ledgerのcanonical hash、実験台帳の可視importとraw record一致を検証する。元FunnelのFACT金融指標を保存時asOfで照合し直すが、新たに帰属・予測しない。未来の入力、未知version、改変された評価、参照不整合は非0終了。古い台帳の自動修正はせず、別途Learningへの取込が必要。

`selectionContext` は `schemaVersion`, `purpose`, `isSynthetic`, `policy`, `registry`, `experimentClassifications[]`, `proposals[]` を持つ。

### policy

- `policyId`, `version=experiment-selector-v1`, `policyHash`（`policy.js`の `POLICY_HASH`）、`configuredBy/At`, `confirmationReference`, `applicablePeriod` を明示する。
- `selectionTrack` は `OBSERVED_PERFORMANCE` / `EXPLORATION`。AUTO・暗黙fallback・混合評価なし。
- `selectionScope={candidateIds:[],channel:null,purpose:null,reason}`。空candidateIdsは入力全候補、null channel/purposeは当該軸で絞らないというpolicy。事実のscopeをnullで一致扱いする意味ではない。
- `comparisonGroup` はScorerのcohort hashまたはnull。異なる既知cohortが複数なら事前指定が必要。不明cohortを「範囲外」にして既知候補だけで選ばない。
- `maxConcurrentMonetizationExperiments` は明示非負整数。ユーザー承認済み初期値は **1**。実装が未設定値を1へ補完することはなく、欠落/nullはUNKNOWN・推薦0件。明示0は新規推薦停止。
- `monetizationGroups` は対象の収益化実験グループ一覧。初期 `['AFFILIATE_MONETIZATION']`。
- `maxSnapshotAgeDays` は明示非負整数。Scorerと観測Funnel snapshotの最大年齢。元需要証拠の鮮度policy・成分適用期間も現在asOfで再確認し、値の更新・0点化はしない。

### registryと同時実行判定

`registry={sourceFileHash,coverage:'COMPLETE'|'UNKNOWN',scope:'ALL_REGISTERED_AFFILIATE_EXPERIMENTS',observedAt,sourceReference,maxAgeDays}`。

対象案と **同じ収益化グループのdistinct RUNNING IDのみ** を数える。`knownRunningCount+1 <= limit` が必要。SEO/indexing/discovery/measurement-onlyは除外。別の明示グループも対象外。不明RUNNINGは対象外と推測せず、件数をnullとして新規推薦を止める。期限切れreviewDateだけでRUNNINGを減らさない。

既存台帳にclassがないため、v1は6つの既知IDと、宣言済み `hypothesis/falsificationCondition/trafficSource/successThreshold/killThreshold` 全体の署名を厳密照合する互換契約を持つ。3つの現RUNNING SEO実験はGSC impressions目的、note対Xはconversions目的を含み `AFFILIATE_ACQUISITION / AFFILIATE_MONETIZATION`。同グループは1件で上限1に達している。タイトル・楽天利用・売上欠測を根拠に分類しない。定義変更・矛盾はUNKNOWN。

未知の実験は `experimentClassifications[]` に `experimentId,experimentClass,monetizationGroup,recordHash,evidencePointers,reason,reviewedBy,reviewedAt,confirmationReference` を持つ明示reviewが必要。自身の宣言目標へのJSON pointerと正確なraw record hashが必要。既知署名との矛盾や未来・古いreviewはUNKNOWN。収益classは `AFFILIATE_ACQUISITION / AFFILIATE_NOTE_ACQUISITION / DIRECT_REVENUE_VALIDATION`、非収益classは `SEO / INDEXING / DISCOVERY / SEO_DISCOVERY / MEASUREMENT_ONLY`。

coverageは供給された登録台帳の確認。repository外の未登録活動がないという保証ではない。runは枠を予約しない。実開始側は最新台帳・同時操作を再確認する。同じLP・台帳に明記された同一計測IDとの干渉確認は、このグループ件数とは別に行う。

### 明示実験案

`proposals[]` は人が用意する。必須は `proposalId,candidateId,assessmentId,contextId,purpose,experimentClass,monetizationGroup,channel,targetLP,itemCodes,scope,hypothesis,falsificationCondition,primaryMetric,successCondition,reviewCondition,measurementPlan,variables,relatedExperimentIds`。同じScorer contextの実LP/channel/offerに一致し、Scannerの全関連履歴を含める。LP生成や候補案の自動生成は行わない。

既存LP・offer記録への参照と、LPのrepositoryPresence=trueが必要。live availability / current priceはUNKNOWNのまま保持し、存在・販売中を捏造しない。実験の変数は `variables` にcontentPattern/titlePattern/CTA等を保持できるが、既存LPやCTAの変更処理はない。

Learningへの下位投影には `WHY_REVISIT,whatChanged,newEvidenceRefs,changes,confirmations,measurement` を渡す。Ledger recordIdをScanner evidenceIdで代用しない。過去のFAILEDはKILLへ変換せず、構造化retry条件・新しい証拠・WHY_REVISITが揃えば推薦可能。条件はSATISFIED / NOT_SATISFIED / UNKNOWN。履歴上retry不要なら `retry.required=false,retryStatus=UNKNOWN` とし、存在しない条件の充足を主張しない。

未解決KILL/HOLD、POSSIBLE_MATCH、revision/source snapshot競合はreviewを要求する。PROPOSEDを確定条件へ昇格させず、RETRACTEDを復活させない。ScannerとLearningの反証は原値・hash・参照を保持し、`historyReview={counterEvidenceHashes,reviewedBy,reviewedAt,reason}` で全てを確認する。確認は反証の否定や制約解除の意味ではない。

### Affiliate note gate

note channel / note purpose / note classは整合必須。`measurement={evidenceRef,htmlPath,ga4PropertyReference}` でLearning内のLPMeasurementRecordと保存HTMLを明示する。htmlPathはselectionContext file基準。既存Funnel validatorを用い、hash、LP、property、affiliate_click送受信証拠、QA、検証者・時刻、適用期間、失効、新しい登録proofを確認する。

`measurementGateStatus=VERIFIED` のみ通過。NOT_VERIFIED / NOT_IMPLEMENTEDは推薦不可。これは保存HTMLの確認でありliveサイトのイベント受信の再実証ではない。実開始時は既存VERIFIED gateを再実行する。既存note対Xへ遡及適用せず、NOTE_NATIVE_MONETIZATIONは入力purposeとして拒否する。

## 比較と出力

各ゲート通過後、指定したtrack内でのみ比較する。探索は35/30/20/15の保存済みHYPOTHESIS値を使い、1成分でもnullなら比較不能。部分点を保持する。実績はApproved Revenue → Revenue → Conversions → EPCの全候補で比較可能なFACT prefixだけ。上位欠測を下位値で補完せず、下位欠測で比較を止める。通貨・期間・snapshot・coverage・grain・account・地域等のScorer cohortを維持する。

観測モードは `referencePerformanceScope` に元FACTのaccountScopeIdとmeasurementIdを明示し、追加で主張するscopeも元観測で裏付ける。過去候補収益を新チャネルへ配分しない。同じ候補の複数チャネル案をその候補の過去収益だけで選ばない。

同点・比較不能は0件。未知競合を最下位へ落とさない。既知で独立した必須gateによりdeferされた案は、その理由を残して比較対象から外せる。単独案も完全な比較scope・値・gateを要求する。ID順・他track・ランダムで同点を解消せず、finalRankを作らない。

出力は `schemaVersion=1,outputType=EXPERIMENT_SELECTION_RECOMMENDATION_ONLY`、`recommendations[]` 最大1件、原 `observedPerformance` と `explorationAssessments`、現在RUNNING分類、グループ別concurrency、全Scanner候補 `candidates[]` と全案 `proposals[]`。各候補・案に次を必ず保存する。

`eligibility,selected,selectionReason,rejectionReason,evidenceRefs,retryStatus,measurementGateStatus,concurrencyStatus`

参照は `sourceId/sourceFileHash/jsonPointer/evidenceType`。推薦はHYPOTHESISで、市場成功・開始許可ではない。案未定義・範囲外候補も理由を保存する。FACT / ESTIMATE / HYPOTHESIS / UNKNOWNは原評価・観測のまま保持する。

private保存先はignored `reports/experiment-selector/<runId>/{selection.json,report.md,run-metadata.json}`。directory0700/files0600、symlink・run上書き拒否、run単位保存。`--private-dir` はOS一時領域の専用directoryにのみ変更可能。入力不正は非0終了、正常な欠測・枠不足・同点は正常な0件レポート。`--start/--publish/--post/--force/--allow-unverified` は存在しない。

## 検証・保護・rollback

新規テスト: `node --test keyword-research/test/experiment-selector-*.test.js`。全体: `npm test`, `npm run strategy:validate`, `node check-links.js`。

synthetic fixturesとhelperはソフトウェア契約検証。非synthetic契約分岐を試すために加工した入力も架空データであり、非0楽天実成果や実市場検証済みとは記録しない。

既存tracked資産はpackage scriptの追加以外不変。docs/**、408記事、LP/CTA/UTM/affiliate URL、既存実験、Article Growth Freeze、daily workflow、Native note、既存4moduleとtests、lockfileを変更しない。追加依存・DB・workflowなし。

rollbackは新CLI利用停止、追加17ファイル相当のcommitをrevert。private run・元証拠を残す。実験状態・公開資産を更新しないため、状態巻き戻しは不要。
