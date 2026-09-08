# keyword-research

Web全体の商品検索需要を調査し、楽天商品へ照合する機能(Phase 1、dry-run専用)。
既存の商品選定・サイト生成パイプライン(`select-products.js` / `generate-site.js`)には
一切変更を加えず、上流の調査〜照合〜レポート生成までを完結させる独立モジュール。

## 状態の分離(2026-09-05 実データ監査対応)

Googleキーワードプランナーの実データ(1,324件)で検証した結果、以下を独立した状態として
分離した。1つの状態を他の状態の代わりに使わないこと(例: 楽天APIエラーは需要データの
検証結果を変更しない)。

| 状態 | 値 | 意味 |
|---|---|---|
| `businessValidated` | true/false | Google需要データ自体の出所・必須項目の検証結果 |
| `rakutenLookupStatus` | `NOT_RUN`/`SUCCESS`/`API_ERROR` | 楽天API照合を実行できたか |
| `rakutenSupplyStatus` | `NOT_EVALUATED`/`ELIGIBLE`/`INSUFFICIENT`/`NO_MATCH` | 楽天側に条件一致商品が十分あるか |
| `safetyStatus` | `SAFE`/`HEALTH_REVIEW_REQUIRED`/`MEDICAL_REVIEW_REQUIRED` | 医療・健康訴求語彙による安全ゲート |
| `queryQualityStatus` | `VALID`/`REVIEW_REQUIRED`/`MALFORMED` | 検索語自体の品質(空・数字のみ等) |
| `decisionStatus` | 上記すべてを踏まえた最終的な運用判定 | `PRIORITY`/`TEST`/`OBSERVE`/`REJECT`/`UNVALIDATED`/`MEDICAL_REVIEW_REQUIRED`/`HEALTH_REVIEW_REQUIRED`/`MALFORMED_KEYWORD`/`QUERY_REVIEW_REQUIRED`/`SUPPLY_NOT_EVALUATED`/`SUPPLY_LOOKUP_ERROR`/`SUPPLY_NO_MATCH`/`SUPPLY_INSUFFICIENT` |

`decision.js`の判定優先順位: businessValidated=false → 医療 → 健康訴求 → 検索語品質 →
楽天照合未実行/エラー → 楽天商品供給(0件/1〜2件) → (rakutenSupplyStatus=ELIGIBLEの場合のみ)
scoreBandをそのまま採用。`scoreBand`は需要・購入意図等から算出したスコア帯であり、
楽天商品供給の有無によって書き換えられることはない(decisionStatusとは完全に分離した値)。
`eligibleForApproval`/`eligibleForExport`/`eligibleForPublish`は、この優先順位のどこかで
ブロックされた時点ですべてfalseになる。

キーワードの表記も4つに分離している: `originalKeyword`(CSV原文、書き換えない)・
`normalizedKeyword`(分類・重複判定用、複合語正規化と語順ソート済み)・
`rakutenQuery`(楽天API専用、助詞除去等の加工を行うが需要データには影響しない)・
`keywordVariants`(統合された原文一覧)。

## 実行方法

```bash
npm run keywords:dry-run                 # research → map-rakuten → report を一括実行(fixtureソース)
npm run keywords:dry-run -- --use-search-console   # 上記に加えてSearch Console実接続も使う
npm run keywords:research -- --manual-csv <path>   # 手動CSVを使う場合
npm run keywords:map-rakuten             # 楽天商品照合(RAKUTEN_APP_ID等があれば実API、無ければfixture)
npm run keywords:report                  # reports/keyword-research/<日付>/ にレポート出力
npm run keywords:validate -- --approved-file <path>  # テスト実行+承認ファイルの形式検証
npm run keywords:export-approved -- --approved-file <path>  # 承認済み候補のmanifestを出力
```

いずれのコマンドもサイトへの公開(`docs/`の変更・`articles-data.json`等の本番状態変更・
commit・push)は一切行わない。`npm run keywords:export-approved` も例外ではなく、
`keyword-research/output/approved-candidates.json` というmanifestファイルを書き出す
ところまでで、既存のページ生成処理への接続(Phase 3)は未実装。

**`npm run keywords:publish` は非推奨**(`keywords:export-approved` の旧名)。実行すると
非推奨警告が表示された上で `keywords:export-approved` に委譲される。互換性のためだけに
残しているコマンドで、いずれ削除予定。**旧コマンド経由でもbusinessValidatedのゲートは
回避できない**(`publish.js`は`export-approved.js`へ処理を委譲するだけで、独自の承認・
出力ロジックを持たないため)。

### Googleキーワードプランナー実CSVの取込(2026-09-06対応)

```bash
# 1. 取込・需要分析だけ(楽天APIは呼ばない)
npm run keywords:import-gkp -- --dog-csv "<犬用CSV>" --cat-csv "<猫用CSV>"

# 2. 楽天照合を含む完全dry-run(--rakuten-sourceは必須)
npm run keywords:gkp-dry-run -- --dog-csv "<犬用CSV>" --cat-csv "<猫用CSV>" --rakuten-source live --max-rakuten-keywords 100
```

- 文字コード(UTF-16LE/UTF-8 BOMあり・なし)・区切り文字(タブ/カンマ)・ヘッダー行位置を
  自動判定する(Google公式エクスポート形式のタイトル行・期間行を含む形式に対応)。
- Windowsネイティブ・Git Bash(`/c/...`)・WSL(`/mnt/c/...`)いずれのパス表記でも入力できる。
- `--rakuten-source live` は`RAKUTEN_APP_ID`/`RAKUTEN_SECRET`が無ければAPIを1件も呼ばず
  非ゼロ終了する(fixtureへの自動フォールバックはしない、fail closed)。
- `--rakuten-source fixture` は明示指定時のみ使用可能で、承認・出力・掲載ゲートは
  すべて強制的にfalseになる(テストデータを実運用候補にしない)。
- 出力は`keyword-research/output/gkp-runs/<runId>/`(gitignore対象)へ保存され、
  同じrunIdの既存結果は上書きしない。`run-metadata.json`に再現性情報
  (candidateSetHash・mappingConfigHash・searchSourceCounts等、認証情報は含まない)を記録する。

### Phase 3A: 非公開下書きページ生成(2026-09-07対応)

```bash
KEYWORD_RESEARCH_DRAFTS_ENABLED=true npm run keywords:build-pilot-drafts -- \
  --source-run keyword-research/output/gkp-runs/<runId> \
  --approved-file <approval.json> \
  --run-id <draftRunId>
```

- 既定では無効(`KEYWORD_RESEARCH_DRAFTS_ENABLED=true`を明示しない限り実行できない)な実験的機能。
- 人間が作成した承認ファイル(`approval.json`: version/sourceRunId/candidateSetHash/approvedBy="human"/
  approvedAt/keywords[](normalizedKeyword/title/slug/action="CREATE"のみ、最大10件))を必須とする。
- source runは`rakutenSource=live`・`status=completed`・`searchSourceCounts`にfixtureを含まない・
  API_ERROR=0・`candidateSetHash`が承認ファイルと一致、のすべてを満たす必要がある(1つでも
  満たさなければ全件生成せず非ゼロ終了する)。
- 候補ごとにbusinessValidated/decisionStatus=PRIORITY/eligibleForApproval/safetyStatus=SAFE/
  queryQualityStatus=VALID/rakutenLookupStatus=SUCCESS/rakutenSupplyStatus=ELIGIBLE/楽天ELIGIBLE
  商品3件以上を検証し、既存サイト(`docs/rankings/`)・既存パイプライン設定(`select-products.js`の
  シードキーワード、同義語対応)とのslug重複・検索意図重複が無いことも確認する。
- 出力は`keyword-research/output/pilot-drafts/<runId>/`(gitignore対象)へ、各候補のHTML
  (noindex,nofollow・DRAFT表示・レスポンシブ対応)・`manifest.json`・`validation-report.md`・
  `run-metadata.json`を保存する。既存サイト(`docs/`)・`generate-site.js`・`select-products.js`・
  日次GitHub Actionsへの接続・公開は一切行わない。楽天/Google/Search Console APIも呼び出さない
  (保存済みのsource runを読み取り専用で使うだけ)。

#### 【重要・2026-09-07判明】商品関連性ゲート(PR#6)と旧下書きrunの扱い

`keyword-research/output/pilot-drafts/phase3a-pilot-drafts-2026-09-07-01/`は、
候補「キャットフード グレインフリー」で犬用おやつ(itemNameに「キャットフード」「猫」を
SEOキーワードとして併記した商品)が誤ってQuality Score 1位表示された**INVALID・公開禁止**の
下書きrunである。原因は、rakuten-match.jsの必須属性一致判定が商品テキスト全体
(itemName+catchcopy+itemCaption)から属性を抽出しており、必須属性(species:cat)と反対属性
(species:dog)が同時に存在する場合に矛盾を検出できなかったため。

この下書きrunファイル自体は削除・変更せず、監査証跡としてそのまま保持する
(gitignore対象のため元々commit対象ではない)。PR#6でrakuten-match.js・
pilot-draft-source-run.js/pilot-draft-build.jsの両方へ、商品名(itemName)を最優先根拠とする
商品関連性ゲート(`product-relevance.js`)を追加した(詳細は`product-relevance.js`の
コメントを参照)。**PR#6のレビュー・マージ後、`phase3a-live-2026-09-07-01`のsource runは
変更せず(楽天API再実行なし)、新しいdraft runId(例:
`phase3a-pilot-drafts-2026-09-07-02`)で下書きを再生成すること。**
上記の旧runIdのディレクトリは再利用・上書きしない。

### Phase 3B: 公開前商品レビュー・データ補完・収益化プレビュー(2026-09-07対応)

Phase 3Aの下書き(内部情報中心・アフィリエイトリンク無し)を、公開前に人間が商品単位で
確認し、画像・楽天アフィリエイトリンク・現在価格を安全に補完したうえで、収益化機能
(商品カード・CTA・アフィリエイトリンク)を含む非公開プレビューへ変換する3段階のCLI。
各段階は独立しており、人間の承認を挟まずに自動で次段階へ進むことはない。

```bash
# 段階A: 公開候補商品レビュー資料の生成(内部確認専用、何も自動承認しない)
npm run keywords:prepare-publication-review -- \
  --source-run keyword-research/output/gkp-runs/<runId> \
  --approved-file <keywordApproval.json> \
  --run-id <reviewRunId>

# (人間がkeyword-research/output/publication-reviews/<reviewRunId>/publication-review.md
#  を確認し、itemCode単位で公開承認ファイルを作成する。自動生成はしない)

# 段階B: 人間承認済み商品だけの限定的な楽天商品補完(1キーワード1検索、--rakuten-source live必須)
npm run keywords:enrich-publication-products -- \
  --source-run keyword-research/output/gkp-runs/<runId> \
  --publication-approved-file <publicationApproval.json> \
  --rakuten-source live \
  --run-id <enrichmentRunId>

# 段階C: 収益化機能を含む非公開プレビュー生成(KEYWORD_RESEARCH_PUBLICATION_PREVIEW_ENABLED=true必須)
KEYWORD_RESEARCH_PUBLICATION_PREVIEW_ENABLED=true npm run keywords:build-publication-preview -- \
  --source-run keyword-research/output/gkp-runs/<runId> \
  --publication-approved-file <publicationApproval.json> \
  --enrichment-run keyword-research/output/publication-enrichment/<enrichmentRunId> \
  --run-id <previewRunId>
```

- 商品公開承認ファイル(`publication-approval.js`)はキーワード承認ファイルとは別スキーマ。
  `schemaVersion`/`sourceRunId`/`candidateSetHash`/`keywordApprovedFileHash`/`reviewRunId`/
  `approvedAt`/`reviewedBy`/`humanApproved`/`pages[].products[]`(1ページ3〜5商品、
  itemCode重複禁止、`displayName`は120文字以下・医療健康表現禁止、商品ごとに
  `humanApproved: true`必須)を持つ。自動生成しない(人間が作成する)。
- 公開ページ単位の必須属性(`publication-attributes.js`)はキーワード必須属性より厳格
  (例: `senior-dog-pork`は`species:dog`/`lifeStage:senior`/`productType:staple`/
  `ingredient:pork`を必須とし、`ingredient:pork`はitemNameで確認できない場合は自動採用しない)。
- 上位表示商品の店舗・シリーズ偏り防止(`shop-diversity.js`): 同一店舗は最大2件、異なる店舗
  最低3店舗、商品名の類似度(決定的な2-gram Jaccard係数)で同一シリーズを検出し3件以上なら拒否。
- 楽天商品補完データはallowlist方式(`publication-enrichment.js`)で保存し、画像URL・
  affiliateUrlは楽天公式のhttpsホストのみ許可する(affiliateUrl欠損時は通常の商品URLへ
  フォールバックしない、fail closed)。
  - **楽天公式仕様**([IchibaItem/Search](https://webservice.rakuten.co.jp/documentation/ichiba-item-search)):
    `affiliateId`を指定した場合、`itemUrl`は`affiliateUrl`と同じアフィリエイト形式の値
    (`hb.afl.rakuten.co.jp`)で返る場合がある。そのため`itemUrl`は`item.rakuten.co.jp`と
    `hb.afl.rakuten.co.jp`の**2つ**を正規ホストとして許可する(2026-09-08 修正)。
  - `affiliateUrl`は引き続き`hb.afl.rakuten.co.jp`のみを許可し、`item.rakuten.co.jp`への
    フォールバックは行わない(itemUrl/affiliateUrlの役割はコード上で分離したまま)。
  - 安全対策: `https:`限定、hostnameの完全一致(部分一致・サブドメイン偽装・後方一致偽装を
    拒否)、`username`/`password`付きURL禁止、デフォルト(443)以外の独自ポート禁止。
    許可ホストを`*.rakuten.co.jp`のように広げることはしない。
- `sourceRunId`/`candidateSetHash`/`keywordApprovedFileHash`/`publicationReviewHash`/
  `publicationApprovedFileHash`/`enrichmentArtifactHash`のいずれか1つでも不一致なら
  生成を拒否する(`publication-preview-build.js`)。
- 出力はすべて`keyword-research/output/`配下(gitignore対象)。既存サイト(`docs/`)・
  `generate-site.js`・`select-products.js`・日次GitHub Actionsへの接続・公開は一切行わない。

### Search Console実接続を使ったdry-runの正式な実行方法

```bash
npm run keywords:dry-run -- --use-search-console
```

`credentials/ga-search-console-key.json`が存在する場合、fixtureデータに加えて
実際のSearch Console実績(直近28日間の検索クエリ・表示回数・クリック数)を取得する。
実行ログとレポート(`summary.md`の「3. 使用データ源」)で`search_console:
configured=true fallbackUsed=false`と表示されれば接続自体は成功している。

**【重要】接続成功と取得件数は別物**: `configured=true`でも、対象期間
(既定は直近28日、`--endDaysAgo`前日まで)にサイトへの実際の検索クエリが
無ければ、取得件数は正当に**0件**になる。**0件は接続失敗を意味しない。**
サイトが新しく、インデックス反映やクロールが進んでいない場合によく起こる。
接続の失敗(認証エラー等)は`fallbackUsed`やログの別のエラーメッセージで
判別できる(0件と接続失敗を混同しないこと)。

### businessValidated=falseの候補について

**businessValidated=falseの候補は、スコアがどれだけ高くても(scoreBand=PRIORITY
であっても)、承認・エクスポート・サイト掲載のいずれにも使用できない。**
`decisionStatus`は強制的に`UNVALIDATED`になり、`eligibleForApproval`・
`eligibleForExport`・`eligibleForPublish`はすべて`false`になる。
`npm run keywords:export-approved`(および非推奨の`keywords:publish`)は、
承認ファイルに含まれている候補であっても、`businessValidated=false`なら
理由コード`BUSINESS_DATA_NOT_VALIDATED`で必ずブロックする。詳細は
「businessValidatedの判定ロジック」章を参照。

## Source層アダプターの実装状況

| ソース | 実装状況 | 本番接続 |
|---|---|---|
| `manual_csv` | 実装済み(必須アダプター) | ローカルCSVファイルなので「本番接続」の概念なし |
| `fixture` | 実装済み(必須アダプター、再現用固定データ) | 同上。**実際の市場需要を示すデータではない** |
| `google_ads` | アダプター本体まで実装済み(HTTPリクエスト含む) | **未確認**(このプロジェクトに開発者トークン等の認証情報が未設定のため) |
| `search_console` | アダプター本体まで実装済み | **確認済み**(既存の`credentials/ga-search-console-key.json`を再利用し、実際に接続動作確認済み) |
| `google_trends` | **インターフェースのみ実装**(関数シグネチャ・設定検出・meta返却のみ)。実際のHTTPリクエストは未実装 | 未接続。既定でOFF。正式API契約が確定するまで非公式スクレイピングでは代替しない |

`google_ads`と`google_trends`の違いに注意: 前者は「実装済みだが認証情報が無いため
未検証」、後者は「そもそもAPI呼び出しのコード自体が存在しない」。どちらも
認証情報が無い状態では観測データを1件も返さない点は共通(`manual_csv`/`fixture`へ
自動フォールバック、またはそのソースだけskip)。

## スコアリングにおける「fixtureと実データの区別」

`WebKeywordScore`の各成分は、データが欠損している場合に**根拠のない仮点数(中間点)を
加算しない**。欠損時は該当成分を0点とし、`reasons`に欠損である旨を明記した上で
`confidence`を`LOW`に落とす。

### `businessValidated`の判定ロジック(2026-09-04監査で刷新)

**`manual_csv`という入力形式であることだけではtrue/falseを決めない。**
`KeywordObservation`の以下のフィールドから判定する(`scoring.js`の
`evaluateBusinessValidation()`参照):

- `sourceProvider`: データの実際の出所(`google_ads_api`/`search_console_api`/
  `google_keyword_planner`/`fixture`/`unknown`等)。`config.trustedSourceProviders`
  (既定値: `google_ads_api`・`google_keyword_planner`・`search_console_api`)に
  含まれない場合は、他の項目が完備していても常に`false`
- `isSynthetic`: 推定値・テスト値・再現用の固定データなら`true`。`true`の場合は
  常に`false`
- `periodStart`/`periodEnd`(取得期間): どちらも無ければ`false`
- データ種別ごとの必須項目: `search_console`は実`impressions`の有無、それ以外
  (Google Ads API・Google Keyword Plannerのmanual_csv)は`monthlySearches`・
  `country`・`language`がすべて揃っているか

判定表:

| データ | `businessValidated` |
|---|---|
| `fixture`(`isSynthetic=true`) | `false` |
| `manual_csv`で`sourceProvider`未指定または`unknown` | `false`(検索量等が完備していても) |
| `manual_csv`で`sourceProvider="google_keyword_planner"`かつ`isSynthetic=false`かつ取得期間・検索量・対象地域・対象言語が確認できる | `true` |
| Google Ads API実データ(`sourceProvider="google_ads_api"`) | `true` |
| Search Consoleで実`impressions`が確認できるデータ(`sourceProvider="search_console_api"`) | `true` |
| 欠損値・推定値・テスト値(`isSynthetic=true`または必須項目欠損) | `false` |

`KeywordScoreBreakdown.businessValidated`(真偽値)と`dataSource`(文字列、元観測の
`source`)は必ず出力される。**`fixture`由来のスコアは実際の市場需要を示すものではない**
ため、`keyword-scores.csv`/`keyword-candidates.csv`の`businessValidated`/
`dataSource`/`sourceProvider`/`isSynthetic`列を必ず確認すること。単体テストは
`test/scoring.test.js`(判定表の全パターン)と`test/sources.test.js`
(各アダプターが正しい`sourceProvider`/`isSynthetic`を設定しているか)を参照。

## `scoreBand`(スコア帯)と`decisionStatus`(実運用判定)の違い(2026-09-05監査対応)

以前は「スコアが高い(PRIORITY)」ことがそのまま「優先候補」として扱われ、
`businessValidated=true`が0件のfixtureのみのdry-runでも「優先候補13件」のように
実運用可能な候補であるかのような表示になっていた。これを避けるため、2つの概念を
明確に分離した(`decision.js`参照)。

- **`scoreBand`**(`PRIORITY`/`TEST`/`OBSERVE`/`REJECT`): `FinalPriority`のしきい値
  だけで機械的に決まる**スコア上の試算結果**。fixture/syntheticなデータでも
  算出される(スコア計算のテストとしては有用)。**実運用可能かどうかは表さない。**
- **`decisionStatus`**(`PRIORITY`/`TEST`/`OBSERVE`/`REJECT`/`UNVALIDATED`):
  実運用上の採否。`businessValidated=false`の候補は、`scoreBand`の値に関わらず
  常に`UNVALIDATED`になる。`businessValidated=true`の場合のみ`scoreBand`の値が
  そのまま採用される。

そこから導かれる3つのゲート(すべて`businessValidated=false`なら強制的にfalse):

- `eligibleForApproval`: 人間が承認する対象になり得るか
- `eligibleForExport`: `keywords:export-approved`で出力され得るか
- `eligibleForPublish`: 既存サイトへ公開され得るか(Phase 3未実装のため、
  `businessValidated=true`でも現時点では常に`false`)

`summary.md`は「7a. スコア帯(simulation/test only)」と「7b. 実運用判定」を別セクションで
表示し、`businessValidated=true`が0件のときは実運用上の優先候補・承認可能候補・
出力可能候補がすべて0件であることを明示する。

## `adsCompetitionGap` について(旧`webCompetitionGap`)

このスコア成分はGoogle Ads Keyword Planningの入札競合指標
(`competitionLevel`/`competitionIndex`)にもとづく**広告入札競合の代理指標**であり、
自然検索(SEO)における実際の競合の強さそのものではない。自然検索の競合状況を直接
測定するデータ源は現時点で未接続。誤解を避けるため、フィールド名を
`webCompetitionGap`から`adsCompetitionGap`に改称し、reasons・レポートにも
「広告入札競合の代理指標」である旨を明記している。

## manual_csvの正式なCSV列一覧

UTF-8、ヘッダー行必須。`keyword`列のみ必須、他は任意(空欄は「欠損」として扱われ、
`0`とは区別される)。

| 列名 | 型 | 説明 |
|---|---|---|
| `keyword` | 文字列(必須) | キーワード原文 |
| `monthlySearches` | 数値 | 月間平均検索ボリューム |
| `competitionLevel` | `LOW`/`MEDIUM`/`HIGH`/`UNKNOWN` | Google Ads競合レベル(広告入札競合、SEO競合ではない) |
| `competitionIndex` | 数値(0-100) | Google Ads競合指数 |
| `lowTopOfPageBid` | 数値(円) | ページ上部掲載の入札単価(低額帯)。スコアには使わずMonetizationMetricsとして参考掲載のみ |
| `highTopOfPageBid` | 数値(円) | ページ上部掲載の入札単価(高額帯)。同上 |
| `impressions` | 数値 | 表示回数(Search Console実績等) |
| `clicks` | 数値 | クリック数 |
| `ctr` | 数値(0-1) | クリック率 |
| `averagePosition` | 数値 | 平均掲載順位 |
| `trendIndex` | 数値(0-100) | トレンドの相対指数(絶対検索数ではない) |
| `country` | 文字列 | 国コード(例: `JP`)。`businessValidated`の必須項目 |
| `language` | 文字列 | 言語コード(例: `ja`)。`businessValidated`の必須項目 |
| `periodStart` | 日付(`YYYY-MM-DD`) | データの取得期間(開始)。`businessValidated`の必須項目(`periodStart`/`periodEnd`のどちらか) |
| `periodEnd` | 日付(`YYYY-MM-DD`) | データの取得期間(終了) |
| `sourceProvider` | 文字列 | データの実際の出所。信頼できる出所として扱うのは`google_ads_api`/`search_console_api`/`google_keyword_planner`(`config.trustedSourceProviders`)のみ。空欄は`unknown`(出所不明)として扱われ、常に`businessValidated=false`になる |
| `isSynthetic` | `true`/`false` | 推定値・テスト値なら`true`と明記する。`true`の場合は`sourceProvider`が信頼できる値でも常に`businessValidated=false` |
| `rawReference` | 文字列 | 出典・エクスポート元の備考 |

サンプル: [`fixtures/manual-keywords.sample.csv`](fixtures/manual-keywords.sample.csv)(秘密情報は含まない)。
3行それぞれ「Googleキーワードプランナー由来で`businessValidated=true`になる例」
「出所未記入で`false`になる例」「`isSynthetic=true`で`false`になる例」を収録している。

### Googleキーワードプランナーのエクスポートを読み込む手順

Googleキーワードプランナーの「キーワードプランを確認」→ CSVダウンロードの列名は
上記スキーマと直接一致しないため、事前に列名を合わせる必要がある。代表的な
対応関係:

| キーワードプランナーの列(日本語UI) | このプロジェクトの列 |
|---|---|
| キーワード | `keyword` |
| 月間平均検索ボリューム | `monthlySearches` |
| 競合性 | `competitionLevel`(「低」→`LOW`、「中」→`MEDIUM`、「高」→`HIGH`に変換) |
| 競合性(指標) | `competitionIndex` |
| ページ上部に掲載された広告の入札単価（低額帯） | `lowTopOfPageBid` |
| ページ上部に掲載された広告の入札単価（高額帯） | `highTopOfPageBid` |

手順:
1. キーワードプランナーからCSVをエクスポート(Googleは通常CSVの先頭に説明行が
   数行付くため、実際のヘッダー行までを残して手動で削除する)
2. 上記対応表に従って列名をこのプロジェクトのスキーマへリネームし、
   `competitionLevel`の値を日本語(低/中/高)から`LOW`/`MEDIUM`/`HIGH`へ変換する
3. `country`/`language`列を追加する場合は`JP`/`ja`を入力(任意)
4. **`businessValidated=true`にしたい場合は必須**: `periodStart`/`periodEnd`列に
   キーワードプランナーで指定した期間(通常は直近12か月)を、`sourceProvider`列に
   `google_keyword_planner`を、`isSynthetic`列に`false`を入力する。これらが
   無いと、検索量等が正しくてもこのプロジェクトの`businessValidated`は`false`の
   ままになる(「manual_csvだから自動的にtrue」にはならない設計のため)
5. 変換後のCSVを読み込む:
   ```bash
   npm run keywords:research -- --manual-csv path/to/converted-keyword-planner.csv
   npm run keywords:map-rakuten
   npm run keywords:report
   ```

自動変換スクリプトは今回のPhase 1には含まれていない(手動での列名調整が必要)。
