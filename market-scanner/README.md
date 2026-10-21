# Market Scanner v1

承認済み `brief-2026-10-21-market-scanner-v1` に基づく、オフラインの市場候補・証拠レポート。記事候補数ではなく、収益実験の検討材料と不足情報を把握するための機能です。

Scannerは候補を提示するだけです。スコア、順位、Top N、期待収益、実験選択・開始、記事/投稿生成、公開、通知を実装しません。楽天・Google・LLM APIも呼びません。NOTE_NATIVE_MONETIZATIONは対象外です。

## 実行

Node 22以降、追加ライブラリ・APIキー不要。入力manifest中のpathはmanifest所在ディレクトリからの相対パス、または明示したローカル絶対パスです。入力は変更しません。

```bash
npm run market:scan -- --manifest /private/scanner-inputs.json \
  --run-id scan-20261021 --as-of 2026-10-21T12:00:00+09:00
```

前回runを比較する場合:

```bash
npm run market:scan -- --manifest /private/scanner-inputs.json \
  --run-id scan-20261022 --as-of 2026-10-22T12:00:00+09:00 \
  --previous-run scan-20261021
```

`as-of`省略時は現在時刻。過去時点との比較・再現には明示してください。run-id省略時はUUID。同じrun-idは上書きしません。

出力は既存gitignore対象の`reports/market-scanner/<runId>/`内に限ります。

- `candidates.json`: MarketCandidate、値ごとのEvidenceRecord、欠測とsource状態、Funnelのrun-level context。
- `report.md`: 人が読む候補の証拠・反証・不足情報。表示順は安定ID順で、収益順位ではありません。
- `run-metadata.json`: 入力hash、code commit、policy、asOf、実行結果。candidateCountは処理確認用であり成功KPIではありません。

テスト・一時確認用の`--private-dir`はOS一時領域の専用サブディレクトリに限ります。docsには出力できません。directory 0700 / file 0600、symlink出力拒否、stagingと排他予約によるrun単位の保存。入力・組立の検証失敗時は成功レポートを残しません。

## Manifest

```json
{
  "schemaVersion": 1,
  "purpose": "AFFILIATE_MONETIZATION",
  "sources": [
    {
      "sourceId": "gkp_202609",
      "sourceType": "gkp_csv",
      "path": "keyword-planner.csv",
      "provider": "google_keyword_planner",
      "sourceReference": "GKP export reference",
      "isSynthetic": false,
      "retrievedAt": "2026-10-01T10:00:00+09:00",
      "country": "JP",
      "language": "ja",
      "timezone": "Asia/Tokyo",
      "grain": "KEYWORD",
      "scope": "Google Keyword Planner JP ja",
      "filters": {},
      "completeness": "COMPLETE"
    }
  ],
  "freshnessPolicy": {
    "gkp_202609": { "maxRetrievedAgeDays": 30, "maxPeriodAgeDays": 90 }
  },
  "links": []
}
```

上の日時・有効日数は入力形式の例であり、既定値・市場FACTではありません。isSyntheticは必須。provider未指定はunknown、元の国/言語/日時/範囲等が不明ならnullのまま保持します。sourceReferenceは非秘密の参照名にし、秘密値や原本の個人情報を入れないでください。

原本hashは読取時に計算します。manifestの`sourceFileHash`を指定した場合は一致を検証します。GKPや保存済みGSCの対象期間とmanifest期間が矛盾すれば拒否します。retrievedAtは原資料の取得日時、parsedAtは今回の読取日時で、相互に代用しません。

JP/jaは対象範囲の初期値として表示しますが、parserの固定値から出所の国/言語を捏造しません。原sourceの国/言語が不明ならSOURCE_REGION_UNKNOWNを表示します。

任意ソース省略はNOT_PROVIDED、正常な空入力はEMPTY。入力未指定・指定した不正ファイルは非0終了。正常入力から候補が出なければNO_CANDIDATESで報告します。fixtureや前回データへの暗黙fallbackはありません。

## Offline source adapters

| sourceType | 入力形式・用途 |
|---|---|
| `gkp_csv` | 既存低レベルencoding/header/period helpersを再利用。UTF-8/BOM・UTF-16LE/BOM・日英header・tab/comma。1ファイルから使用可能 |
| `manual_csv` | UTF-8/UTF-16LE CSV、keyword必須。下記の任意列で観測を保存 |
| `gsc_csv` | keyword/query/上位のクエリ/クエリ、clicks/クリック数、impressions/表示回数、ctr、averagePosition/position/掲載順位等 |
| `gsc_report` | 既存search-trial report.json。requestedPeriodとpages[].searchConsole.topQueriesを読む。query結果は部分集合 |
| `opportunities` | strategy/opportunities.jsonのitems。市場の種、既存ID・仮説・反証・unknowns。旧scoreは利用しない |
| `experiments` / `decisions` | 既存items。状態・結果・学び・関連判断を読取専用で参照 |
| `seasonality` | 既存items。confidence・peakMonths・leadTimeDays・notesを保持 |
| `funnel_report` | PR #33のreport.json。報酬・欠測・snapshot・通貨・粒度・帰属制約を保持 |
| `competitors` | 既存items。keyword・observedAt・pageUrl・sourceTypeを持つSERP観測 |
| `lp_inventory` | 検索試験設定のpages。pathはdocs基準の相対パス |
| `offers` | articles-data.json等の商品配列/台帳。itemCode・過去価格・snapshotDate等 |
| `measurement_records` | PR #33のLPMeasurementRecord単体、配列、またはitemsで包んだ配列 |

manual CSVの数値列: monthlySearches、impressions、clicks、competitionIndex、averagePosition、ctr、lowTopOfPageBid、highTopOfPageBid。competitionLevelも保存可能。任意のrow単位periodStart/periodEnd/country/language/timezone/sourceProvider/retrievedAt/isSyntheticを保持します。rowのsynthetic指定はsourceのsyntheticを解除できません。

manual CSVの値はprovider名だけでFACTにしません。`<metric>EvidenceType`列（例: `impressionsEvidenceType`）→ rowの`evidenceType`列 → manifest sourceの`evidenceType`の順で明示区分を保持し、未指定はUNKNOWNです。区分は原資料の申告であり、本CLIによる実測検証ではありません。GKP/GSC固有の意味づけとは分けます。

空数値はnull、実際の0は0。範囲値は数値へ中央値変換せず、rawValueとnullを保持します。桁区切りは読めますが不正な値・不正引用符・列数不一致・重複必須headerは拒否します。

## Evidence / 候補の意味

各EvidenceRecordは値、rawValue、単位、FACT/ESTIMATE/HYPOTHESIS/UNKNOWN、availability/reason、source ID/原本hash/record参照、取得日時、対象期間、地域、粒度、scope、syntheticとfreshnessを持ちます。

GKPのmonthlySearchesは提供元推計としてESTIMATE。GSCは自サイト検索実績で、市場全体の検索数、note exposure/view/outbound clickとは違います。ルールから得る意図・購買意図・暫定themeはHYPOTHESIS。ルールに一致しない意図をINFORMATIONALと断定せずUNKNOWNにします。既存台帳の仮説や反証は保持します。

候補の必須項目はtheme、keywords/intent、demandEvidence、ads/organicを分けたcompetition、purchaseIntent、seasonality、availableLPs、existingOffers、observedRevenueEvidence、evidenceFreshness、関連実験/判断、measurementReadiness、signals/counterEvidence/unknowns/reviewFlags、evidenceRefsです。出力型はMARKET_CANDIDATES_ONLY固定。

候補IDは市場条件・原意図・属性・国/言語・synthetic区分から決定します。語順ソートしたcanonicalKeywordは参照用だけで、意味の異なる語を自動統合しません。疑わしい候補は別に保持します。医療/健康訴求や検索語品質の既存安全判定もreview flagとして保持し、公開や実験を実行しません。

同じ証拠は追加の需要と数えず、複数出所はadditionalSourcesに残します。期間・地域・scope違いの観測は別に保持します。類似語量の合算、期間違いの最大値を代表需要として採用、欠損を0点/平均値へ補完する処理はありません。

旧pipeline・scoring・final-priority・gkp-selection・自動認証のGSC adapterは呼び出しません。元のコード自体も変更しません。将来のScorerは本出力の証拠と欠測を明示的に利用する別PRです。

## LP / offer / 実験への関連づけ

入力manifestのlinksで対応根拠を明示します。例:

```json
{
  "keyword": "シニア 猫 フード",
  "opportunityId": "senior-cat-food-jp",
  "theme": "シニア猫向けフード",
  "targetLP": "https://yoshimitsu-20251105.github.io/rakuten-affiliate/rankings/senior-cat-food.html",
  "evidenceReference": "existing opportunity and LP review",
  "itemCodes": [],
  "seasonalityIds": [],
  "experimentIds": ["exp-2026-10-05-senior-cat-food"]
}
```

keywordの表記一致またはopportunityIdで関連づけ、異なる地域/言語を強制統合しません。同じkeywordへ矛盾する市場mappingがあれば拒否します。GSCのquery/page関係も参照できますが、LPの購買意図適合を証明したとは扱いません。

local fileの存在はFACT、現在の200応答/在庫/価格/適合性は別項目。docs外やdocs外へ出るsymlinkの参照は拒否します。offerはitemCodesで明示関連づけ、古いrecordedPriceを現在価格とは表示しません。snapshotDateが不明ならnull。

RUNNING実験に重なる候補はRUNNING_EXPERIMENTを表示します。FAILED/INCONCLUSIVE/KILLを別の意味へ書換えず、過去の決定・反証・WHY_REVISITに必要な新証拠不足を表示します。既存note対X実験も変更しません。

LPが未計測/未検証でも候補を消しません。PR #33の共通validatorを使い、VERIFIED証拠と現在のローカルHTML hashを照合します。これもlive checkではありません。新規Affiliate note実験の開始gateは後続Plannerへ接続するもので、本CLIは実験を開始しません。

## Funnelとの結合

アカウント全体の成果はrunContextだけに保持し、候補へ配分しません。0-record snapshotから全候補または未観測IDの0円を作りません。

候補へ既存報酬を関連づける場合、linksのmeasurementIdMappingsに次を指定します:

```json
{
  "measurementId": "ACTUALLY_OBSERVED_ID",
  "accountScopeId": "ACCOUNT_REFERENCE",
  "targetLP": "https://example.test/fixed-lp.html",
  "validFrom": "2026-09-01",
  "validThrough": "2026-09-30",
  "exclusiveToCandidate": true,
  "evidenceReference": "verified mapping reference"
}
```

必要条件は、原record由来のreport.byMeasurementIdに存在、account一致、対象LP一致、有効期間が成果periodを包含、排他的対応の根拠あり、snapshot/retrievalがasOfより未来でない、synthetic区分一致です。ID名やクリック比率から帰属を推測しません。共有ID・複数snapshot・矛盾するscopeでは報酬を合算/二重帰属せずnullと理由にします。

RevenueとMerchandise Salesを混同せず、Approved Revenue / availability / currency / retrievedAt / scope / period / PARTIALLY_VERIFIEDをそのまま保持します。ScannerでConversionsやEPCを再計算・補完しません。現在のFunnelが対応を証明できないEPCはnullのままです。

## Freshness / 差分

maxRetrievedAgeDaysとmaxPeriodAgeDaysは任意のsource別policyで、未設定時はFRESHNESS_NOT_EVALUATED。どちらか不明ならUNKNOWN、元データ取得がasOfより未来ならAFTER_AS_OFです。古いFACTを当時のFACTとして保持し、現在への適用可能性を別表示します。

retrievedAgeDaysは経過日数、periodAgeDaysはasOfのUTCカレンダー日とperiodEndの暦日差です。元ソースの最終データ時刻や確定を証明する値ではありません。parsedAt・mtimeで鮮度を更新しません。

同じ入力/policy/asOfなら候補ID・内容を再現できます。parsedAt/generatedAtだけの違いは候補更新としません。前回との差分はNEW / UPDATED / UNCHANGED / NOT_OBSERVED_THIS_RUN。未観測を市場消滅・失敗・KILLへ変換しません。

## 検証と限界

`npm test`がmarket-scanner-*.test.jsを実行します。source構造、実測0とnull、重複、意味の非統合、鮮度、LP/offer、実験・Funnelの欠測/帰属、計測証拠、private CLI、run差分、ネットワーク呼出し禁止、保護対象diffを検証します。

`keyword-research/fixtures/market-scanner-*`はsynthetic形式確認用です。ここから出た候補は市場需要や収益の実証ではありません。実入力の欠落はUNKNOWN/NOT_PROVIDEDとして報告します。実ソース7種類すべてのデータが提供・検証済みとは主張しません。

保護対象は既存408記事・docs/LP/CTA/UTM/affiliate URL/計測ID、snapshotDate/lastmod、既存実験とstrategy、Freeze、daily workflow、Funnel Measurement、NOTE_NATIVE_MONETIZATIONです。既存tracked変更はpackage.jsonのCLI登録だけです。依存・lockfile変更なし。

将来の楽天API sourceは、規約・取得/保存/更新条件・レート制限・認証を確認した別Brief/PRで追加します。v1で認証情報を要求したり、ソース不足を楽天API/fixtureで補ったりしません。

rollbackは新CLI停止と本PR差分revert。既存の原本・Funnel/strategy/実験を保全し、private run履歴を削除しません。Freezeと計測gateも維持します。

日報追加候補: Scanner v1実装、入力/欠測/帰属/差分の検証結果、実データで使用した範囲とUNKNOWN。既存台帳・日報へ自動追記しません。
