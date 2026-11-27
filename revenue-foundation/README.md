# Autonomous Revenue Foundation v1

```sh
node revenue-foundation/cli.js radar /private/radar-input.json
node revenue-foundation/cli.js scorer-context /private/radar-input.json /private/scanner-report.json
node revenue-foundation/cli.js quality /private/quality-artifact.json /private/verified-observations.json
node revenue-foundation/cli.js inventory
```

CLI は JSON を標準出力に返す。Scorer に渡す場合は context を private ファイルに保存し、既存 Scorer CLI の `--context` を使う。出力先を公開ディレクトリに設定しない。

## Radar

入力は `schemaVersion: 1`、タイムゾーン付き `asOf`、`candidates`、任意の `maxAgeDays`（既定14）。各候補に `opportunityId`、`topic`、`category`、`keywords`、`observedAt`、`isSynthetic`、`signals` を渡す。任意の `seasonality` は `peakMonths`・`sourceRef`・`evidenceType` を持つ。季節性の根拠は方向判定に使わない。

各 signal に `source`、`sourceRef`、`observedAt`、`evidenceType`、`previous`、`current` を渡す。値は同じ指標・単位・範囲で比較可能な期間の観測値で、欠測には `null` を使う。ソースごとの直近の有効な比較が割れた場合は UNKNOWN。期限切れ候補は末尾へ移り、再評価が必要になる。合成観測は ESTIMATE または HYPOTHESIS とする。

provider は `id`、`requiresCredentials`、`hasCredentials`（真偽値）、`isSynthetic`、非同期 `read(query)` を持つ。接続先アダプターに資格情報の読み込みを閉じ込める。必要な資格情報がない provider は呼び出さず、NOT_AVAILABLE を返す。

Scorer との連携には `scannerCandidateId` と各比較の `scannerEvidenceRef` が必要。現行 Scanner の同一候補・provider・現観測値に対応する根拠でのみ Demand の仮説点を提案する。方向は既存15点枠に UP=15、FLAT=7.5、DOWN=0 として写像する。Scorer の鮮度・欠測判定を通過した値だけが採用される。

## Quality Gate

評価対象 JSON は `schemaVersion: 1`、`targetUrl`（または `pagePath`）、`html`（または `content`）、UTF-8 HTML の SHA-256 を表す `targetHash`、タイムゾーン付きの `asOf` を指定する。Gate は HTML からハッシュを再計算して出力し、申告ハッシュが異なる場合は FAIL。caller の点数、判定、evidenceRefs は採点に使用しない。

第2ファイルは、評価対象の提出元と独立して管理する検証済み観測の JSON 配列。プログラムからは `evaluateQuality(input, { verifiedEvidence })` で渡す。レビュー担当者または測定処理が観測を検証し、CLI の実行者が信頼できるレジスターを選ぶ。Gate 自体は外部ソースの認証や取得を行わない。レジスターを省略した場合、外部観測が必要な採点項目と gate は確認できない。

各レコードには `id`、`sourceRef`、`evidenceType: "FACT"`、`isSynthetic: false`、単一の `appliesTo`、`targetHash`、タイムゾーン付き `observedAt`、`observation` が必要。適用先、対象ハッシュ、取得日時、観測の型を照合し、未来・期限切れ・合成・不足した根拠は採用しない。新鮮さを要する SERP、鮮度、性能、類似性調査は30日、その他は90日以内。根拠が衝突した場合は低い点数を採用する。

| appliesTo | observation |
|---|---|
| searchIntentFit | `query`, `reviewedResults`, `intent`（TRANSACTIONAL / COMMERCIAL / INFORMATIONAL / NAVIGATIONAL）, `pageQuote` |
| originalAnalysis | `pageQuote`, `method`（UNIT_COST / MEASURED_TEST / COMPARATIVE_ANALYSIS / NONE）, `independentInputs`, `reproducible` |
| comparisonSpecificity | `pageQuote`, `comparedProducts`, `comparisonCriteria` |
| freshness | `checkedAt`, `materialFactsCurrent` |
| evidence | `pageQuote`, `checkedClaims`, `supportedClaims` |
| performance | `device: "MOBILE"`, `lcpMs`, `inpMs`, `cls` |
| ctaFit | `linkLabel`, `destinationMatches` |
| scaledContentRisk | `comparedPages`, `maxSimilarity`（0〜1）, `doorwayPages`, `thinPages` |
| fakeExperience | `claim`（HTML から抽出した文）, `actualUse`（USED / NOT_USED） |

静的 HTML から title/H1、内部リンク、viewport、広告明示、Rakuten または sponsored のリンク属性、実使用表現を検査する。静的検査の範囲は HTML で確認できる要素・属性に限る。検索意図、独自分析、根拠の検証は必須。80点以上、かつ4つの Hard Gate がすべて PASS の場合に総合 PASS とする。

## Legacy inventory

`docs/articles/` の商品ページを棚卸しし、サイトマップとローカル HTML を読み取る。同一店舗内の正規化タイトルの類似度は要確認の候補を示す。公開先の商品有効性、Google の登録状態、Search Console 実績は UNKNOWN。結果には優先順と候補判定を含み、公開資産への操作は実行しない。
