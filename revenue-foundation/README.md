# Autonomous Revenue Foundation v1

```sh
node revenue-foundation/cli.js radar /private/radar-input.json
node revenue-foundation/cli.js scorer-context /private/radar-input.json /private/scanner-report.json
node revenue-foundation/cli.js quality /private/quality-review.json
node revenue-foundation/cli.js inventory
```

CLI は JSON を標準出力に返す。Scorer に渡す場合は context を private ファイルに保存し、既存 Scorer CLI の `--context` を使う。出力先を公開ディレクトリに設定しない。

## Radar

入力は `schemaVersion: 1`、タイムゾーン付き `asOf`、`candidates`、任意の `maxAgeDays`（既定14）。各候補に `opportunityId`、`topic`、`category`、`keywords`、`observedAt`、`isSynthetic`、`signals` を渡す。任意の `seasonality` は `peakMonths`・`sourceRef`・`evidenceType` を持つ。季節性の根拠は方向判定に使わない。

各 signal に `source`、`sourceRef`、`observedAt`、`evidenceType`、`previous`、`current` を渡す。値は同じ指標・単位・範囲で比較可能な期間の観測値で、欠測には `null` を使う。ソースごとの直近の有効な比較が割れた場合は UNKNOWN。期限切れ候補は末尾へ移り、再評価が必要になる。合成観測は ESTIMATE または HYPOTHESIS とする。

provider は `id`、`requiresCredentials`、`hasCredentials`（真偽値）、`isSynthetic`、非同期 `read(query)` を持つ。接続先アダプターに資格情報の読み込みを閉じ込める。必要な資格情報がない provider は呼び出さず、NOT_AVAILABLE を返す。

Scorer との連携には `scannerCandidateId` と各比較の `scannerEvidenceRef` が必要。現行 Scanner の同一候補・provider・現観測値に対応する根拠でのみ Demand の仮説点を提案する。方向は既存15点枠に UP=15、FLAT=7.5、DOWN=0 として写像する。Scorer の鮮度・欠測判定を通過した値だけが採用される。

## Quality Gate

入力は `schemaVersion: 1`、`evidence[]`（`id`、`sourceRef`、`evidenceType`、`isSynthetic`）、`gates`（各ゲートの `status` と `evidenceRefs`）、`dimensions`（各項目の `points`、`evidenceRefs`、任意の `required`）。SERP、検索意図、比較根拠、クロール、内部リンク、構造化データ、端末・性能の監査結果は該当項目の evidence として渡せる。合成根拠は加点に使用しない。

任意の `content` は日本語・英語の代表的な実使用表現を検出する。`experienceClaims` には `text`、`actualUse`（USED / NOT_USED / UNKNOWN）、`evidenceRefs`、任意の `firstHand` を渡す。`scaledContentSignals` は監査で確認した DOORWAY / NEAR_DUPLICATE / THIN_MASS_CONTENT を渡す。自由文の意味判定や、外部サイトへの照会は行わない。

## Legacy inventory

`docs/articles/` の商品ページを棚卸しし、サイトマップとローカル HTML を読み取る。同一店舗内の正規化タイトルの類似度は要確認の候補を示す。公開先の商品有効性、Google の登録状態、Search Console 実績は UNKNOWN。結果には優先順と候補判定を含み、公開資産への操作は実行しない。
