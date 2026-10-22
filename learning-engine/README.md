# Learning Engine v1

過去の結果・反証・判断・学びと再試行条件を、出所と適用範囲付きで参照するoffline CLI。Approved Revenue → Revenue → Conversions → EPCを優先し、記録数・記事数・投稿数を成功KPIにしない。

既存strategy、公開資産、実験、Freeze、daily workflow、NOTE_NATIVE_MONETIZATIONは変更しない。実験の選択・開始・停止、SCALE/KILL/IMPROVE/HOLDの実行、生成・公開・投稿・通知・API呼出しは行わない。判断を保存したことを施策実行済みとは扱わない。

## 実行

Node 22以降、追加依存・APIキー不要。

```bash
npm run learning:import -- --manifest /private/learning-inputs.json
npm run learning:record -- --review /private/experiment-review.json
npm run learning:report -- --run-id review-20261022 --as-of 2026-10-22T18:00:00+09:00
npm run learning:review -- --proposal /private/proposal.json --run-id retry-20261022
```

最初の2コマンドだけが明示入力をprivate ledgerへ追記する。report/reviewはledgerを変更しない。後者のreviewは検討案の照合であり、判断を新しく決める処理ではない。初回report時のledger不存在はエラー。fixture・前回ファイルへのfallbackはない。

出力は既存gitignore対象の`reports/learning-engine/ledger.json`と`runs/<runId>/{review.json,report.md,run-metadata.json}`。directory 0700 / files 0600。台帳・runのsymlink、同一runIdの上書き、docs/strategyへの出力を拒否する。テスト用`--private-dir`はOS一時領域の専用directoryだけ。

asOf/runId未指定は現在時刻/UUID。再現時はasOfを指定し、metadataのledger/input/policy hashとcode commitも保存する。CLIで台帳の記録日時を過去へ戻すオプションはない。syntheticだけを見るときはreport/reviewに`--synthetic`。合成データを実績へ混ぜない。

## Input contract

manifestはschemaVersion=1、purpose=AFFILIATE_MONETIZATIONまたはAFFILIATE_NOTE_ACQUISITION、sources[]、任意links[]。

```json
{
  "schemaVersion": 1,
  "purpose": "AFFILIATE_MONETIZATION",
  "sources": [
    {"sourceId":"legacy-experiments","sourceType":"experiments","path":"/path/to/strategy/experiments.json","sourceReference":"tracked strategy snapshot","isSynthetic":false},
    {"sourceId":"legacy-decisions","sourceType":"decisions","path":"/path/to/strategy/decisions.json","sourceReference":"tracked decisions snapshot","isSynthetic":false}
  ],
  "links": []
}
```

pathはmanifest基準またはローカル絶対path。例のpathは実ファイルに置き換える。保存するprovenanceに入力絶対pathは含めない。sourceReferenceには非秘密の参照名を使う。

sourceId/type/path/sourceReference/isSyntheticは必須。optional expectedSha256はraw bytesと照合する。retrievedAt/period/timezone/scopeは実際に分かる場合だけ記入。不明はnull。今回の取込日時で元の取得日時を埋めない。

| sourceType | contract |
|---|---|
| experiments | 必須・1つ。既存items形式。6実験の元状態・result・decision・metrics・自由文を保持。正常な空はEMPTY |
| decisions | 任意。既存items形式。自由文はLEGACY_OTHER / decision=null。文中のKILL等を操作enumへ変換しない |
| funnel_report | PR #33 schemaVersion=1 / purpose=AFFILIATE_FUNNEL_MEASUREMENT。batch、MetricObservation、ID別実績を保持 |
| scanner_report | PR #34 schemaVersion=1 / MARKET_CANDIDATES_ONLY。source/evidence/hash/参照を既存validatorで検証 |
| scorer_report | PR #35 schemaVersion=1 / OPPORTUNITY_ASSESSMENTS_ONLY。元のscannerRunIdとraw file hashが一致するscanner_reportも必須 |
| measurement_records | PR #33 LPMeasurementRecord単体・配列・items。VERIFIEDの証拠構造を既存validatorで検証 |

不正version/型/enum/参照/hash、明示ファイルの不存在・破損は非0終了。省略sourceはNOT_PROVIDED。Native noteのpurposeは拒否する。共通AFFILIATE_MONETIZATION ledgerでAffiliate noteのreviewを扱えるが、目的からNOTE_NATIVE_MONETIZATIONを取り込む経路はない。

linksはsourceId、既存experimentIdに、必要ならcandidateId、assessmentId/contextId、accountScopeId、measurementId、channel/arm、targetLP、period、evidenceRefs、mappingEvidenceReferenceを明示する。IDはprivate ledger/reportから参照する。候補・assessmentの指定は元snapshotに存在する必要がある。リンクは既存実験を作成・変更しない。

## データモデル / 出所 / 事実区分

ledgerは5配列を持つ。

- SourceImport: raw hash、元metadata、adapter version、code commit、recordRefs、取込時刻。
- ExperimentSnapshot: 元のstatus/result/decisionとraw experiment。過去の自由文learningsも保持。
- EvidenceRecord: metric/claim、value/rawValue、FACT/ESTIMATE/HYPOTHESIS/UNKNOWN、元観測日・取得日・期間・scope・検証限界。
- DecisionRecord: 明示KILL/IMPROVE/HOLD/SCALEまたは自由文、理由、反証、確認者・日時、retry方針。実行しない。
- LearningRecord: claim、反証assessment、evidence/counterEvidence、scope、review状態、版、再試行条件。

各recordIdは意味のあるpayloadのhash。recordedAtは独立。sourceRefsからSourceImport.recordRefsをたどり、raw file hashと元sourceを確認できる。JSON整形や項目キー順だけ違う原本は新しい出所として追跡しても、同じ観測のrecordを増やさない。snapshot反復を追加の成果や支持回数として数えない。

既存metricsは日付付きの過去実測として保持する。再取得していないこと、metadata不足、現在の計測検証でないことを表示する。古いFACTを今の市場FACTにはしない。`FACT:`の自由文prefixはsource-declared区分であり、新しいFACT Learningへ自動昇格させない。

review JSONのtop-levelはschemaVersion/purpose/reviewId/isSynthetic/reviewedAt/reviewedBy/confirmationReference/decisions[]/learnings[]。実装形式はsynthetic fixtures参照。fixtureのIDや金額を実データへ流用しない。

各review項目はlogicalId/revisionId、任意supersedesRevisionId/resolvesRevisionIds、既存experimentIds、scope、reason、evidenceRefs/counterEvidenceRefsを持つ。判断はdecision/retryPolicy/reviewDate。学びはclaim/reviewStatus/falsification/retryConditions/decisionRefs/unknowns/limitations/scopeEvidenceRefsを持つ。

claimはtext、metricOrClaim、value、evidenceType（任意unit/missingReason）。UNKNOWNはvalue=nullとmissingReason必須。FACTは元観測のmetric/value/scopeとの一致を必要とする。原因解釈に適当な観測を引用しただけでFACTにしない。ACCEPTEDなHYPOTHESISもHYPOTHESISのまま。文字列textの意味を自動検証・因果判定したとは主張しない。

新しいfalsification assessmentはhypothesisRef、事前条件原文、SUPPORTED/FALSIFIED/INCONCLUSIVE/UNKNOWN、支持・反証refs、理由を持つ。人が記録した評価であり、threshold条件の自由文を機械実行しない。FAILEDをKILLにせず、期限超過でRUNNINGを自動終了しない。

## 訂正と競合

過去entryを変更・削除せず、新revisionを追記する。同じlogicalId/revisionの別内容は拒否。supersedesRevisionIdは同じlogicalIdの既存版を指す。循環・未来の親・synthetic区分違いを拒否する。

同じ親から二方向の訂正が出たらCONFLICT。新しい方や売上の高い方を採用しない。解消版はresolvesRevisionIdsで全leafを明示する。RETRACTEDも新revisionで記録し、元のclaim・反証を残す。

source experimentの内容が変わったときも別snapshotとして保存する。原資料に有効時刻や版の継承関係がない場合、取込順で結果を上書きせずSOURCE_CHANGED_REVIEW_REQUIRED / CONFLICTとする。これは既存experiment自体のstatus変更ではない。

asOfはsystem記録時点とsource観測/取得時点の双方を検査する。後日取り込んだ観測を、その台帳が過去時点で知っていたかのように表示しない。元の日付しかない情報に架空の00:00を保存せず、同日内の前後関係が立証できなければUNKNOWN。

## Revenueと欠測

Observed Performanceの4指標はFunnelのFACTだけ。Scorerの探索点は別contextのまま保持し、加算・重み付け・単一順位を作らない。35/30/20/15とnull規則を変更しない。

rewards=commission。Revenueは有効PENDING+APPROVED、Approved RevenueはAPPROVED、Cancelled Revenueは別表示。amountはMerchandise Sales。元reportを保持し、取消の二重減算・CSV横断の行merge・snapshot金額加算をしない。

帰属には実report recordにあるmeasurement_id、同じaccount/期間、共有されていない実験/チャネル対応が必要。明示mappingEvidenceReferenceに加え、対象experiment/LP/channelの`measurement_id`観測EvidenceRecord（FACT・対応開始以前の観測日）が必要。IDと期間の自己申告だけでは財務値を採用しない。

適用可能な同一cohortの最新snapshotを1つ参照する。複数scope/通貨/期間や同一時点の内容競合はnull。共有ID、対応不明、PARTIAL、非FACT、syntheticもnull。期間・取得日・通貨・grain・snapshot・承認段階は元MetricObservationに残す。

正式ZERO_RECORD_SNAPSHOTはaccountの取得時点0。未取得とは別で、特定候補の0円に配分しない。進行月を最終0円としない。非0件ConversionsのPARTIALLY_VERIFIED/null、クリックコホート未検証EPCのnullを維持する。review入力から数値を追加・復活させない。

新しいSCALEを記録しても実行しない。実験レポートでREVENUE_VALIDATION_MISSINGや計測根拠不足を示す。数値の未達や不足からKILL/HOLDを自動で決めない。

## 再試行条件

正式statusは**SATISFIED / NOT_SATISFIED / UNKNOWN**のみ。旧BriefのMET/NOT_METは使用しない。

conditionId/type/required/predicate/expectedValue/scope/evidenceRefs/reason、任意validFrom/validUntilを持つ。scopeは既知のexperiment/theme/offer/channel/LP/contentPattern/titlePattern/CTA/カテゴリ/priceBand/国/言語/期間等。nullをwildcardや一致にしない。

| type | 固定predicate / expectedValue |
|---|---|
| MEASUREMENT_VERIFIED | VALID_AT_REVIEW / {}。指定LPに既存validatorが有効とする証拠が必要 |
| NEW_EVIDENCE | OBSERVED_AFTER_REVIEW / metric, after, 任意maxAgeDays。後のimport日時だけでは充足しない |
| CHANGED_VARIABLE | DECLARED_CHANGE / field, from, to。前後観測・変更理由・検討案の新値が必要 |
| OBSERVATION_WINDOW | COMPLETE_THROUGH / endDate, 任意periodStart, 明示final。経過時間だけでは充足しない |
| REVIEW_CONFIRMATION | REVIEWED / reviewer。指定reviewerのconfirmationとscope・根拠が必要 |

任意コードや自由文evalはない。無効predicateは拒否。必須条件にNOT_SATISFIEDがあれば全体NOT_SATISFIED。そうでなくUNKNOWNがあればUNKNOWN。必須条件が1つ以上あり全てSATISFIEDのときだけSATISFIED。必須条件なしはUNKNOWN。

proposalはschemaVersion/purpose/proposalId/isSynthetic/scopeと、任意relatedExperimentIds/WHY_REVISIT/whatChanged/newEvidenceRefs/changes/confirmations/measurement。未知IDやsynthetic境界の参照を拒否する。

過去との照合はEXACT_SCOPE/POSSIBLE_MATCH/NO_MATCH。同一LPの別channel、scope不足は可能な関連として表示し、同一失敗と断定しない。RUNNING同一LPはACTIVE_EXPERIMENT_OVERLAPとして表示するだけ。

記録済みKILL等を別項目で表示し、過去KILLはPREVIOUSLY_KILLED_REVIEW_REQUIRED。Learningの再試行全体判定には有効なACCEPTED版、EXACT_SCOPE、WHY_REVISIT/whatChangedと実際に新しい関連FACTが必要。不足や版競合はUNKNOWN。全条件がSATISFIEDでもCONDITIONS_SATISFIED_REVIEW_REQUIREDであり、canStartExperiment=false。

## Affiliate noteと計測gate

affiliateClickMeasurementStatusはVERIFIED / NOT_VERIFIED / NOT_IMPLEMENTEDのみ。LPの現在HTML bytesとGA4 propertyを指定し、PR #33 measurementAvailabilityで検証する。新しい有効recordや失効を古いproof選択で迂回しない。証拠競合はNOT_VERIFIED。

proposalのmeasurementはevidenceRef（ledger内lp_measurement）、htmlPath（proposal基準の保存済みHTML）、ga4PropertyReference。CLIはHTMLを読むだけ。保存済みHTML/送受信参照の検証はlive取得の証明ではない。全て満たしても自動開始しない。実開始する将来のPlannerはassertNewAffiliateNoteExperimentAllowedを改めて実行する。

既存note対Xは変更・遡及補完しない。投稿URL・pattern・title/CTAが未記録ならnull。Note Exposure / Note View / Outbound LP Click / LP Session / Affiliate Click / Conversion / Approved Revenueは別指標。GSCやGA4の別指標で穴埋めしない。likesだけを収益成果にしない。

Content Pattern Learningは変数と実験別観測・反証を関連付けて参照する範囲。勝ちパターンの自動認定、推定CVR/収益予測、配点学習はない。AffiliateNotePost台帳は後続Acquisition Planner PR。Native noteや毎日のnote生成を取り込まない。

## 整合性 / tests / rollback

全入力・参照を検証後、排他lockとtemp renameでledgerをatomic更新する。検証/保存障害で旧ledgerを残し、破損ledgerを空にしない。run保存はledger更新と独立。report失敗後のimport再実行でも二重取込にならない。中断lockの回復は他writer停止とledger健全性を確認してから人が行う。

npm testはlearning-engine-*.test.jsを収集する。新規テスト、全体テスト、strategy:validate、check-links、master比の既存tracked差分/hashを確認する。既知Linux/Windows pathテストは変更しない。synthetic正常系は実市場・実成果検証済みを意味しない。

rollbackは新CLI停止と本変更revert。private ledger・原入力・証拠・履歴は削除しない。既存Funnel/Scanner/Scorer、実験、公開資産、workflow、Freezeは維持する。

日報追加候補: Learning Engineの実差分、実験結果/判断/学びの分離、retry三値、tests/protected hash、UNKNOWN。strategy台帳や日報へ自動追記しない。
