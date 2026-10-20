# PR1 — Funnel Measurement v1

Approved Revenue / Revenue / Conversions / EPCを、未取得・未計測・帰属不能と混同せずに観測する。公開ページ、既存実験、日次workflow、Article Growth Freeze、NOTE_NATIVE_MONETIZATIONは変更しない。AffiliateNotePostの本実装はAcquisition Planner PRへ延期する。

## 証拠と検証範囲

- FACT（ユーザー確認、2026-10-20）: 楽天「注文別成果」`order.csv`、report label `2026.10`はUTF-8 BOM、前置き説明・日本語header・machine headerを持ち、成果recordは0件。statusは0=未確定、1=確定、2=破棄。`measurement_id`列が存在する。
- 本実装環境には原本order.csvは提供されていない。`keyword-research/fixtures/funnel-order-zero.csv`は確定仕様を再現した匿名化構造fixtureであり、実ファイルのbyte-for-byteコピーではない。リンク・デバイス説明の内容は実値を主張しない。
- SYNTHETIC: 非0件レコード、金額、計測ID、送受信検証証拠はテスト専用。非0件の楽天実データで検証済みとは記録しない。
- UNKNOWN: 非0件の行粒度、安定した成果識別子、日付/rateの詳細表記、同一成果の状態遷移、IDから実験/チャネルへの一意帰属、クリックコホートとの結合。
- HYPOTHESIS: 正しい欠測表示とsnapshot管理で、0件誤認・二重加算・推測帰属による誤判断を防げる。売上増加自体を保証する機能ではない。

## Parser / 正規化

原本bytesをSHA-256にし、UTF-8を厳密にdecodeする。BOM、LF/CRLF、引用符内のカンマ/改行/二重引用符に対応。不正な引用符・UTF-8は拒否する。

`注文別成果`title、日本語header、report labelを検証し、次のmachine headerを唯一のデータ開始位置とする。前置き行を成果として扱わない。

```text
date,rewards,rate,amount,genre_name,shop_name,item_name,status,link_type,device_type,measurement_id
```

全11列必須。列順はmachine headerに従う。未知追加列は無視した列名を`unknownColumns`へ記録し、既知の列へ推測代入しない。重複列・空列・列数不一致は拒否。空recordは数えない。header以降の非空footerも成果として推測せず拒否する。

`sourceStatus`は元セルを保存し、0→PENDING、1→APPROVED、2→CANCELLED、それ以外→UNKNOWN。UNKNOWNを未承認扱いにしない。日付は`occurrenceDateRaw`、料率は`rateRaw`として保持し、未検証の表記を変換しない。

非0件の金額は現時点で空欄または非負の整数表記のみ対応。空欄はnull。JPYで安全な整数範囲を超える値・未確認の小数/通貨記号/桁区切りは採用せず、次の実CSV確認時にadapterを拡張する。rewardsをamount×rateから作らない。

## データ契約

JSDocの`ImportBatch` / `PerformanceRecord` / `MetricObservation` / `LPMeasurementRecord`は`model.js`、実行時検証は各入力moduleにある。

取込metadataは次を明示する。CSVの月ラベルから通貨・timezone・完全性を推測しない。

```json
{
  "reportLabel": "2026.10",
  "accountScopeId": "synthetic-account",
  "currency": "JPY",
  "timezone": "Asia/Tokyo",
  "dateBasis": "OCCURRENCE_DATE",
  "inputMode": "SNAPSHOT",
  "coverage": "COMPLETE",
  "filters": {},
  "sourceReference": "synthetic-anonymized-format-fixture",
  "snapshotAsOf": "2026-10-20T09:00:00+09:00",
  "retrievedAt": "2026-10-20T09:01:00+09:00",
  "sourceGeneratedAt": null,
  "isSynthetic": true
}
```

上は説明用のsynthetic metadataであり、実CSVの取得日時・通貨・範囲を証明するものではない。実取込は実際の取得条件・時刻を記録し`isSynthetic:false`とする。個人名・認証情報をsourceReferenceに入れない。PR1は無フィルタのアカウントsnapshotだけを扱い、増分や計測IDフィルタ済みCSVは拒否する。

生成batchはreport期間、観測日、時点、出所、原本hash、正規化hash、schema/adapter version、通貨、粒度、検証状況を保存する。元資料にない出力日時はnull。原本の商品名等は成果台帳へ複製せず、hashと行番号で原本を参照する。

## 指標と欠測

| 指標 | 定義 |
|---|---|
| Revenue | 最新snapshotのPENDING + APPROVEDのrewards |
| Approved Revenue | APPROVEDのrewards |
| Cancelled Revenue | CANCELLEDのrewardsを別表示。Revenueから再減算しない |
| Merchandise Sales | amountの原本全行合計。取消を含むため純売上ではない |
| Conversions | 非0件の行≠1conversion。null / PARTIALLY_VERIFIED |
| 0-record snapshot | COMPLETEな正式出力なら上記金額・件数は取得時点の0。ただし件数粒度の実運用検証はPARTIALLY_VERIFIED |

正式0件はZERO_RECORD_SNAPSHOTであり、NOT_IMPORTEDではない。進行月はIN_PROGRESS、終了済み月でもENDED_NOT_FINALIZED。いずれも`final:false`であり、「月次最終Revenue=0」としない。snapshotAsOf/retrievedAtを必ず表示する。

未取得・UNKNOWN status・空報酬・未計測・未検証・反映遅延・帰属不能はnullと理由を持つ。PARTIAL入力の小計はPARTIALと表示し、完全な実績やEPCに使用しない。

measurement_idは実recordに存在するIDだけを集計する。0件CSVから特定IDの0円を生成しない。IDがあっても、note/X/実験への帰属は別の根拠が必要。アカウント全体の収益はサイト収益とは限らない。PR1はチャネル/実験への収益配分をしない。

## Snapshot / 重複防止

同一scope・同一snapshotAsOfで同じ原本hashまたは正規化内容ならDUPLICATE。行順だけ違う再出力も検出する。異なるas-ofの同じ内容は新しい観測として保存するが、報告は常に1つのsnapshotだけを選び、金額を加算しない。

同一scope/as-ofの矛盾は拒否。古いファイルを後から取り込んでもsource snapshotAsOfで選択する。異なる月・通貨・期間・粒度を自動合算しない。安定した成果IDが不明なため、CSVをまたいだ行単位のmerge・取消のdelta減算は行わない。syntheticと実データは選択対象を分離する。

全検証後、排他lockと一時ファイルrenameで単一ledgerを更新する。障害時は元ledgerを保持する。クラッシュ後の`.import-lock`は他の取込停止と台帳の健全性を確認後、人が除去する。破損ledgerを空台帳へ置き換えない。

## GA4 / GSC / EPC

既存`analytics:search-trial-report`の保存済みreport.jsonを読み取る。Google API/認証を新しいCLIから呼ばず、既存安全ゲートを変更しない。旧報告も変更しない。

GA4 metadataには`retrievedAt`、`sourceReference`、`ga4PropertyReference`、`timezone`、`dataCompleteThrough`（不明ならnull）、`qaExclusionStatus`（確認できた場合のみCONFIRMED_CLEAN）を渡す。未確認の反映日を要求日から埋めない。旧GSCの`dataLastAvailableDate`も反映済みの証明には使わない。

targetLPはクエリなしの正規URLと一致させる。sessions / PV / affiliate_clickは区別し、既存Affiliate CTR式（eventCount/PV×100）を維持する。GSCは検索流入、既存チャネル内訳はSESSION_DEFAULT_CHANNEL_GROUPであり、noteのOutbound LP ClickやUTM campaign実績とは読み替えない。

EPC式はRevenue / 対応するGA4観測affiliate_click。Approved EPCも別項目。欠測・PARTIAL・分母0・未検証・期間/母集団/通貨不一致では数値を出さない。

**今回確認されたorder CSVにはクリック識別子がなく、注文発生日とクリック発生日のコホート対応を立証できない。そのためPR1のCSV統合レポートはEPCを理由付きnullにする。** 期間が同じだけで検証済みEPCと呼ばない。計算関数のsynthetic正常系テストは、実データの対応を証明しない。Market Scannerはこのnullを0 EPCや候補除外の根拠にしない。

## LPMeasurementRecord / 新規Affiliate note gate

affiliateClickMeasurementStatusはVERIFIED / NOT_VERIFIED / NOT_IMPLEMENTEDのみ。

VERIFIEDは正規targetLP、確認日時・確認者、検証時HTMLのSHA-256、GA4 property、affiliate_click名、対象LPでの送信とGA4受信の両証拠・各日時・参照先、QA操作参照、適用期間を必要とする。入力した証拠参照の実在性は人が確認する。コード/タグがあるだけでVERIFIEDにしない。

```json
{
  "targetLP": "https://example.test/rankings/test.html",
  "affiliateClickMeasurementStatus": "NOT_VERIFIED"
}
```

検証記録は内容hash別に非公開保存し、過去記録を上書きしない。新規開始検証では最新の有効な記録を指定する。古い証拠へ戻して無効化を迂回しない。現在HTML hash・property・適用期間・失効日時が一致しない場合はNOT_VERIFIED。検証後の同日新規開始は可能だが、検証前の時間を含む日別集計を遡ってVERIFIEDにはしない。

`check-note-start`は新規AFFILIATE_NOTE_ACQUISITION専用。experimentIdとVERIFIED証拠がなければ非0終了。実験状態・投稿・既存note対X実験には触れない。Acquisition Planner PRはこの共通gateを開始処理へ必ず接続する。PR1だけで外部投稿や人の操作を制御したとは主張しない。

## CLI

Node 22以降、追加依存なし。実データの入力JSON/CSVは既存ignored領域`reports/`内、またはcheckout外に置く。

```bash
npm run funnel:import-order -- --csv /private/order.csv --metadata /private/order-metadata.json
npm run funnel:report -- --account ACCOUNT_REFERENCE --month 2026.10 --run-id review-20261020
```

syntheticレポートは`--synthetic`を付ける。過去時点選択は`--as-of <timezone付き日時>`。同一run-idは上書きしない。

既存analytics報告を統合する場合:

```bash
npm run funnel:report -- --account ACCOUNT_REFERENCE --month 2026.10 \
  --analytics-report /private/search-trial/report.json \
  --analytics-metadata /private/ga4-source-metadata.json \
  --lp https://example.test/rankings/test.html \
  --measurement-record /private/measurement.json --html /private/current-lp.html
```

```bash
npm run funnel:validate-measurement -- --measurement-record /private/measurement.json
npm run funnel:check-note-start -- --experiment-id NEW_EXPERIMENT_ID \
  --measurement-record /private/measurement.json \
  --lp https://example.test/rankings/test.html \
  --html /private/current-lp.html --property EXISTING_PROPERTY_REFERENCE
```

private outputは`reports/funnel-measurement/ledger.json`、`measurement-records/<hash>.json`、`report-runs/<run-id>/report.{json,md}`。既存gitignore対象であり、docsへ出力しない。実行logに原本行・認証情報・絶対pathを表示しない。ディレクトリ0700、ファイル0600、symlink出力拒否。テスト用`--private-dir`はOS一時領域の専用サブディレクトリに限定する。

## Tests / rollback

`npm test`が新規funnel-*.test.jsを含む。追加テストはnode:testのみ。正式0件構造と非0件syntheticを分けて検証し、実API呼出しなし。保護対象のtracked diffも検査する。

rollbackは新CLI停止とPR差分revert。非公開原本・台帳・証拠は削除せず保存し、既存GA4/GSC運用へ戻す。Freezeや計測必須条件は緩めない。

日報追加候補: PR1成果取込/状態検証/欠測保護の実装とテスト結果。既存experiments/decisions/daily reportsを自動更新しない。
