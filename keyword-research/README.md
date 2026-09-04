# keyword-research

Web全体の商品検索需要を調査し、楽天商品へ照合する機能(Phase 1、dry-run専用)。
既存の商品選定・サイト生成パイプライン(`select-products.js` / `generate-site.js`)には
一切変更を加えず、上流の調査〜照合〜レポート生成までを完結させる独立モジュール。

## 実行方法

```bash
npm run keywords:dry-run                 # research → map-rakuten → report を一括実行
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
残しているコマンドで、いずれ削除予定。

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
