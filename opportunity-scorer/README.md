# Opportunity Scorer v1

承認済み `brief-2026-10-21-opportunity-scorer-v1` とImplementation Planに基づく、offlineの候補評価・比較CLI。

Observed PerformanceとExplorationは別構造・別関数・別比較です。両者の加算・平均・重み付き統合や、単一の総合順位は作りません。

事業KPIはApproved Revenue → Revenue → Conversions → EPC → Affiliate Clicks → Affiliate CTR → Qualified Sessions → Exposure / Impressions。記事数・投稿数・候補数・点数自体を成功指標にしません。

## 実行

Node 22以降。追加依存、APIキー、新しい認証設定は不要です。

```bash
npm run opportunity:score -- \
  --scanner-report /private/market-scan/candidates.json \
  --context /private/assessment-context.json \
  --run-id score-20261021 --as-of 2026-10-21T12:00:00+09:00
```

`--context`は任意。`--as-of`省略時は現在時刻、`--run-id`省略時はUUID。比較を再現するときはasOfを明示します。前回比較は`--previous-run <id>`。

出力先は既存ignored領域`reports/opportunity-scorer/<runId>/`。`assessments.json`、`report.md`、`run-metadata.json`だけをrun単位で保存します。directory 0700 / files 0600、同一runId上書き・symlink拒否。テスト/一時確認用の`--private-dir`はOS一時領域の専用サブディレクトリに限ります。docsへ出力できません。

保存済み入力は読み取るだけです。不正JSON/型/version/参照/hashは非0終了し、成功レポートを残しません。未指定の任意contextは欠測、正常な空Scanner入力はNO_CANDIDATES。fixtureや前回データへのfallbackはありません。

## Input contract

ScannerのschemaVersion=1 / outputType=MARKET_CANDIDATES_ONLYのJSONを1つ受け取ります。候補/evidence/sourceのID・hash・参照・期間・synthetic・計測証拠を検証します。Scannerの起動、API取得、原本の補完は行いません。

任意contextの形式:

```json
{
  "schemaVersion": 1,
  "purpose": "AFFILIATE_MONETIZATION",
  "scannerRunId": "actual-scanner-run",
  "assessments": [{
    "candidateId": "actual-candidate-id",
    "contextId": "review-1",
    "isSynthetic": false,
    "scope": "declared comparable purchase-market scope",
    "country": "JP",
    "language": "ja",
    "assessedAt": "2026-10-21T12:00:00+09:00",
    "assessedBy": "reviewer-reference",
    "applicablePeriod": {"start": "2026-10-21", "end": "2026-10-31"},
    "components": {
      "purchaseIntent": {
        "value": 30,
        "maxScore": 35,
        "evidenceType": "HYPOTHESIS",
        "reason": "Specific, evidence-backed interpretation",
        "inputRefs": ["/candidates/0/intent"]
      }
    }
  }]
}
```

これは書式例です。ID、JSON Pointer、日付、scopeは実入力に合わせます。例のJP/ja・期限を元資料のFACTにしません。任意の`scannerFileHash`、`policyVersion`、`policyHash`を指定した場合は一致を検証します。

purposeはAFFILIATE_MONETIZATION / AFFILIATE_NOTE_ACQUISITIONのみ。targetLP/itemCodesを指定するときは同じ候補の既存対応と一致させます。channel未指定をnoteやorganicへ補完しません。

componentは`value / maxScore / evidenceType / reason（またはrationale）`、`evidenceRefs`または`inputRefs`を持ちます。未知はvalue=null / UNKNOWNにできます。複数の明示評価は同成分を配列で指定でき、同一内容は重複として扱い、異なる内容はCONFLICTにします。高い方や新しい方を勝手に選びません。

inputRefsは同一候補のintent/keywords/availableLPs/existingOffers/purchaseIntent/demandEvidenceへのJSON Pointer。他候補や財務フィールドは参照できません。evidenceRefsも同一候補の証拠IDに限り、Funnelの財務証拠を探索点へ接続できません。demandは候補のdemandEvidenceに属する原観測が必要です。

contextは解釈を保存するもので、価格・在庫・Revenue・計測受信の新しい観測を追加する経路ではありません。新しい原観測が必要なら別途正規の入力を更新してScannerを再実行します。このCLIから更新しません。

## Component definitions / fixed policy

| component | maxScore | 評価する問い |
|---|---:|---|
| purchaseIntent | 35 | 購入行動につながる仮説か |
| offerFit | 30 | 明示した既存offerが購買条件に適合するか |
| lpReuse | 20 | 既存LP・導線を仮説検証へ再利用できるか |
| demand | 15 | 指定期間/scopeの需要証拠が仮説を支持するか |

valueは配点適用後の有限数0..maxScore（小数可）。0..4へ量子化せず、35%等を二重適用しません。既知点はHYPOTHESIS、未知点はUNKNOWN。評価モデル全体のevidenceTypeはHYPOTHESISであり、Revenue予測ではありません。

4成分が既知のときだけ合計を小数2桁へ丸めます。1成分でもUNKNOWN/nullならtotalScore=null。既知成分は保持します。

- `30/35, null/30, 20/20, 12/15` → totalScore=null。
- `30/35, 24/30, 20/20, 12/15` → totalScore=86。
- 証拠付きの4成分0 → totalScore=0。未知とは別です。

欠測を0点、平均、中央値、既知点だけの100点換算、欠測ペナルティへ変換しません。低い点にも根拠が必要です。

明示評価がないpurchaseIntentだけ、Scanner分類EXACT_PRODUCTから35、CONDITION_PURCHASE/COMMERCIAL_COMPARISONから26.25の初期仮説を作れます。PROBLEM_SOLUTION/INFORMATIONAL/fallbackは自動採点せずnull。旧intent配点/FinalPriorityは使いません。

offerFit/lpReuse/demandはv1で明示評価がなければnull。LP存在だけで満点、商品数だけで満点、検索量だけで満点にしません。現在価格・現在販売・適合を推測しません。GSC 0や索引失敗だけを市場需要0の証拠にしません。

## Output contract / missingness

各成分に次の9キーを必ず出します。

| キー | 意味 |
|---|---|
| value | 配点済み点数またはnull |
| maxScore | 35/30/20/15 |
| evidenceRefs | 原証拠ID。未提供は空配列 |
| evidenceType | 既知点HYPOTHESIS、未知UNKNOWN |
| source | sourceId/type/provider/reference/hash/元取得日時/元事実区分等 |
| period | assessment適用期間と証拠ごとの元期間 |
| freshness | Scorer asOfでの状態、policy、元取得日時/期間末等 |
| reason | 点数・状態の理由 |
| missingReason | 既知ならnull、未知なら欠測・不適用・矛盾等の理由 |

追加でrationaleの原評価、inputRefs、ルール派生かを保存します。元証拠のFACT/ESTIMATE/HYPOTHESIS/UNKNOWNを保持し、派生評価で上書きしません。複合LPフィールドを一括FACTへ昇格しません。

鮮度は元retrievedAtとperiodEnd・source別policyからScorer asOfで再評価します。未設定はFRESHNESS_NOT_EVALUATED。元日時不明は現在需要を立証せず、demand点をnullにします。古い証拠をparsedAt/mtimeで新しくしません。assessmentの時刻/適用期間と証拠の時刻は別です。日別の適用判定は正規化asOfのUTC暦日を使います。

## Observed Performance

Approved Revenue / Revenue / Conversions / EPCのみ。Scannerが保持するFunnel由来のFACTと、raw reportの元ID別metric・importId・snapshot・scope・証拠が一致するときだけ値を採用します。非FACT、PARTIAL、synthetic、帰属不能、共有ID、原ID不在、時点不適用ではnullです。元sourceObservationは理由とともに保持します。

Revenueはrewards由来のcommissionであり、amount（Merchandise Sales）ではありません。accountの0-recordを候補の0円へ配りません。snapshot合算や取消の再計算、推測配分をしません。

PR #33の非0件ConversionsのPARTIALLY_VERIFIEDを維持し、数え直しません。ScannerのEPC nullもsourceEpcから復活・再計算しません。現在の実注文CSVはクリックコホート対応を立証できないため、その制約が残ります。

進行月の0はsnapshot時点の値であり月次最終0ではありません。Approved Revenue=0 / Revenue>0も、承認待ち等の状態を持つ観測値であり、市場失敗の確定には使いません。

## Independent comparisons

performanceRankとexplorationRankを別々の構造に持ちます。表示は安定ID順で、順位と表示順を混同しません。

実績比較は通貨/期間/observedThrough/snapshot/timezone/dateBasis/coverage/grain/account/地域/承認段階等の既知条件が一致するcohort内だけ。Approved Revenue → Revenue → Conversions → EPCの全員で既知の連続prefixを使い、上位指標の欠測を下位指標で補いません。未知のcontext同士を同じnullだから一致としません。

探索比較は全4点が既知で、policy/asOf/地域/言語/scope/purpose/channel/需要の元source種別・単位・期間・粒度・鮮度policyが比較可能な場合だけ。GKP市場推計とGSC自サイト露出を同じ需要指標にしません。

不完全候補はUNRANKEDとして保持し、最下位0点・自動REJECTへ変換しません。同値は同順位。同順位の次は通常の競技順位（1,1,3）です。cohortが1件だけなら順位null / INSUFFICIENT_COMPARABLE_PEERS。syntheticの点数計算は見せても、実候補順位へ混ぜません。

## Measurement / experiment constraints

affiliateClickMeasurementStatusのVERIFIED / NOT_VERIFIED / NOT_IMPLEMENTEDを維持し、VERIFIEDは保存済みPR #33形式の証拠を検証します。Scorerが現在の送信/受信を再実証したとは扱わず、SCANNER_SNAPSHOT_ONLY / requiresStartTimeRevalidation=true / canStartExperiment=falseを出します。

新規Affiliate noteにはVERIFIEDが必須。高得点でもgateを迂回しません。実際の開始時は後続Plannerが既存共通gateを最新証拠で再検証します。Scorerは実験を選択・開始・停止しません。

RUNNING重複、FAILED/INCONCLUSIVE、過去KILL/WHY_REVISITと反証を保持し、自動変更しません。既存note対Xを遡及修正しません。NOTE_NATIVE_MONETIZATIONのpurposeは拒否し、日々のnote生成実績を混ぜません。

## Repeatability / validation / rollback

同一入力/policy/asOfで同じ結果。原ファイルのSHA-256、code commit、policy/hash、context hashをmetadataに残します。前回runとの差はNEW/UPDATED/UNCHANGED/NOT_OBSERVED_THIS_RUN。未観測をKILLにしません。policy/asOf変更は市場改善と呼ばず、異なるcohort間の順位差を改善としません。

`npm test`は新規opportunity-scorer-*.test.jsを既存runnerで収集します。source整合、配点・null、独立比較、計測証拠、private保存、ネットワーク呼出し禁止、入力/保護対象不変を検証します。

checked-in fixturesは既存Funnel parser/reportとMarket Scannerから生成した**syntheticの形式確認用**です。テストでnon-synthetic schema分岐を模擬しても、非0件楽天実データ・需要・収益性の検証済みとは扱いません。

rollbackは新CLIの利用停止と本PR差分revert。原入力・既存strategy/Funnel/Scanner台帳・private run履歴は維持します。既存公開資産・workflow・実験・Freezeは変更しません。

日報追加候補: 実装差分、追加/全体テスト、実Scanner候補での欠測確認、保護対象hash、UNKNOWN。日報や台帳へ自動追記しません。
