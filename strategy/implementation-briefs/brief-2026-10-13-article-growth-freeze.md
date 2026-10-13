# Implementation Brief

> **状態: Briefのみ。実装はまだ行わない。**

## ID

brief-2026-10-13-article-growth-freeze

## Objective

収益実績のない自動生成商品ページ(`docs/articles/`)が毎日増え続ける処理を一時停止する。止めるのは**新規商品記事の追加だけ**。既存408ページの削除・`noindex`はしない。将来、収益性の高いテーマが確定したときに、意図的に再開できる状態にする。

## Business KPI

Revenue / Traffic / Measurement に直接効かない作業の停止(「記事数・ページ数は成功KPIにしない」というCLAUDE.mdの方針に沿う)。副次的に、Googleの品質評価に対する「大量自動生成」のリスク(HYPOTHESIS)の増加を止める。

## Hypothesis

- HYPOTHESIS: 収益実績がないまま自動生成ページを増やし続けることは、サイト全体の品質評価(scaled content / thin affiliateの観点)に不利に働く。増加を止めても、既存ページの価値は変わらない
- HYPOTHESIS: 増加を止めると、日次の差分がなくなり、`sitemap.xml`の`lastmod`・クロールが安定し、インデックス診断(別レーン)を読みやすくなる

## Evidence

2026-10-13時点:

- FACT: 商品記事は現在408ページ(`docs/articles/`)。サイト開始(2026-08-17)から約2か月で追加された
- FACT: 日次の新規追加数(botコミットごと): 10-05 2件 / 10-06 4件 / 10-07 2件 / 10-08 1件 / 10-09 3件 / 10-10 3件 / 10-11 1件 / 10-12 0件 / 10-13 2件(定期実行)。なお10-13にはその後、手動実行(`workflow_dispatch`、本番反映の確認用)でさらに3件が追加され、408件になった
- FACT: GA4(2026-08-17〜2026-10-13): サイト全体のセッションは約76。記事ページでトラフィックがあったのは1ページ(2セッション)。`affiliate_click`イベントはサイト全体で0件(2026-10-13確認)
- FACT: `docs/articles/`を生成するのは`generate-site.js`だけ(他にこのディレクトリへ書き込むコードはない)。検索公開試験ページは別系統(`keyword-research/`の公開パイプライン)で`docs/rankings/`に書き込まれる
- FACT: 新規記事の追加を止めるための既存のスイッチ(環境変数・設定ファイル・feature flag)は存在しない。存在するのは、各枠(`furusatoTier`・`seasonalTier`・`evergreenTier`・`discoveryTier`)に直書きされた`pickCount`だけ

## Counter Evidence

- 記事ページがロングテール検索で将来流入を得る可能性は、増加を止めると新規分については失われる。ただし現時点で実流入・クリックの証拠がない
- 新規ページの追加がサイト全体の「更新頻度」シグナルになっている可能性(UNKNOWN。根拠なし)
- 追加を止めても、既存408ページが引き続き「大量自動生成」とみなされるリスクは残る。本Briefはリスクの増加を止めるだけで、解消はしない

## 現在の新規記事追加経路

日次ワークフロー(`.github/workflows/`、毎日22:07 UTCに設定されているが、実際の開始は直近で00:50〜03:00 UTC頃。`workflow_dispatch`でも手動実行できる)の順序:

1. `node select-products.js`: 楽天APIを枠ごと・キーワードごとにライブ検索(1.2秒間隔)し、基準を満たした未掲載の商品を選定して`selected-products.json`を**上書き**。選んだ商品の`itemCode`を`posted-history.json`へ**追記**。APIエラーは`api-errors.log`(gitignore対象)へ
2. `node generate-site.js`: `selected-products.json`の商品のうち、`articles-data.json`に未登録の`itemCode`だけを`articles-data.json`へ**追記**(`generate-site.js`の追記処理、`snapshotDate`を付与)。その後、全商品の`docs/articles/*.html`、ランキングページ、`index.html`、`sitemap.xml`を再生成
3. `node generate-social-posts.js`: `articles-data.json`のランキンググループからSNS投稿文を作成(`social-posts.txt`、gitignore対象)。商品の個別ページではなく、ランキングページのURLを使う
4. `node check-links.js`: `docs/`内の内部リンクの実在を検証
5. APIエラーの有無の確認 → `git add -A`で差分があればcommit・push → GitHub Pagesのビルド確認 → 通知メール(差分があった場合のみ「サイト更新・公開完了」)

新規記事が増える唯一の入口は、手順1の選定結果(`selected-products.json`)が手順2の追記処理に渡ること。

## 最小停止方法の比較(A / B / C)

| 案 | 内容 | 長所 | 短所・リスク |
|---|---|---|---|
| **A. `select-products`の実行を止める** | A1: ワークフローから該当ステップを外す / A2: `select-products.js`の冒頭で、定数1つにより早期終了する | 上流で止まるため、(1)楽天APIの呼び出しが0になる、(2)`posted-history.json`が汚れない(停止中に候補だった商品は、再開後も候補のまま残る)、(3)`selected-products.json`も更新されず日次の差分が出ない。再開は定数の切り替えだけ(A2) | A1はCI設定(`.github/workflows/`)の変更になり、再開もCI変更が必要。A2は`generate-site.js`側に防御がなく、前提(`selected-products.json`が既登録商品のみ)が崩れると記事が増えうる(通常は崩れない) |
| **B. `generate-site.js`で新規itemを追加しない** | 追記処理の前に定数で分岐し、`articles-data.json`へ追加しない | 記事が増える直前で止まるため、手動実行でも確実に止まる | `select-products`が動き続けるため、(1)楽天API呼び出しが続く、(2)`posted-history.json`に「掲載していない商品」が追記され続け、再開後にその商品は二度と候補にならない(履歴の汚染)、(3)`selected-products.json`が毎日変わり、日次commit・通知メールが毎日発生する。既存テストの多くが`selected-products.json`から商品を追加する前提のため、テストの前提を直す必要がある |
| **C. 既存の設定/feature flagを使う** | 既存のスイッチを使う | — | **存在しない(上記Evidence)**。`pickCount`を0にする案(C′)は、(1)4つの枠(月で変わる関数を含む)の複数箇所の書き換えが必要、(2)`pickFromTier()`は`pickCount`に関係なくキーワードごとのAPI検索を実行するため、API呼び出しが減らない、(3)`selected-products.json`が`[]`に変わるため、初回だけ差分が出る。不採用 |

## 推奨方法

**A2: `select-products.js`の冒頭に定数`ARTICLE_GROWTH_FROZEN = true`を置き、trueの場合は何も書き込まずに終了(exit 0)する。**

- 定数は環境変数ではなくソースコード内に置く(再開には意図的なPRが必要)。環境変数・ワークフロー変数は、設定の見落としで意図せず再開される可能性があるため使わない
- 早期終了は、楽天の環境変数のチェックより前に置く(停止中は秘密情報が未設定でも失敗しない)
- 早期終了時は、停止中であること、再開方法、`selected-products.json`・`posted-history.json`・`api-errors.log`に触れないことをログに出す
- `generate-site.js`は変更しない。`selected-products.json`は停止時点の内容のまま残り、その商品はすでに`articles-data.json`に登録済みなので、`generate-site.js`は新規追記をしない(既存の`existingCodes`判定)。停止前に最後に選ばれた3件が再処理されるだけで、追加は起きない
- 理由: 上流で止めることで、API・履歴・日次差分の3つの副作用を同時に避けられ、変更が最小(1ファイル1定数)で、`generate-site.js`と既存テストの前提を変えずに済む。Bの防御は、手動実行まで止める必要が出た時点で追加を検討する(現時点では不要と判断)

## 維持するもの

既存408記事 / 既存ランキングページ / 検索公開試験5ページ(`grain-free-dog-food.html`含む) / GA4・`affiliate_click` / `sitemap.xml`・`lastmod`(PR #28) / `robots.txt`・canonical / 日次の`generate-site.js`・`check-links.js`・GitHub Pagesビルド確認 / `snapshotDate`表示

## 期待される副作用(実装前に把握しておくこと)

- FACT(コードからの確認): 新規商品がなく、`articles-data.json`・生成結果が変わらない場合、日次処理は差分を出さず、commit・push・「サイト更新・公開完了」メール(SNS投稿文の添付を含む)は送られなくなる。つまり、**日次のSNS投稿文の下書きメールが届かなくなる**。この下書きをオーナーが使っているかはUNKNOWN
- FACT: 楽天APIの日次の呼び出しがなくなるため、`api-errors.log`・「【要確認】APIエラー通知メール」による日次のAPI死活監視もなくなる。キー失効やリファラ制限の変更に気づけなくなる(再開時に確認が必要)
- ESTIMATE(GitHub公式仕様の記憶、本Briefでは再確認していない): 公開リポジトリでは、リポジトリに60日間アクティビティがないと、スケジュール実行のワークフローが自動で無効化される。日次のbotコミットがなくなるため、オーナーや他の作業によるコミットが60日以上途絶えた場合に該当しうる。実装時に公式ドキュメントで確認する
- 検索公開試験(`keyword-research/`のパイプライン)は別系統のため影響しない

## Scope

- `select-products.js`に早期終了の定数と分岐を追加する(1ファイル、数行)
- 停止動作を検証するテストを追加する
- 実装時に、`strategy/decisions.json`への判断記録の候補(決定: 新規自動記事の追加を一時停止、理由、再開条件)を提示する(自動では書き換えない)

## Files Allowed To Change(実装を承認された場合)

- `select-products.js`
- `keyword-research/test/`配下の新規テスト(例: `select-products-freeze.test.js`)
- 必要な場合のみ`strategy/CURRENT_STATE.md`(停止中であること)

## Files Not Allowed To Change

- `docs/`配下のすべて(既存408記事、ランキング、検索公開試験ページ、`sitemap.xml`、`robots.txt`)
- `generate-site.js`、`lib/`、`generate-social-posts.js`、`check-links.js`
- `.github/workflows/`
- `articles-data.json`、`selected-products.json`、`posted-history.json`
- CTA・affiliate URL・GA4の計測コード
- 既存記事の削除、一括`noindex`、商品情報の再取得処理の追加、大規模リファクタ

## Implementation Requirements

- 定数が`true`のとき、`select-products.js`は楽天APIを一切呼ばず(ネットワークアクセス0)、`selected-products.json`・`posted-history.json`・`api-errors.log`を作成・更新せず、終了コード0で終わる
- 定数が`false`のとき、従来どおりの動作に戻る(再開は定数の切り替えのみ。`posted-history.json`が保持されているため、停止中に候補だった商品も二重掲載されない)
- 早期終了の判定は、環境変数のチェックより前に行う
- 他のファイルのロジックを変更しない

## Measurement Plan

実装後、日次実行(または手動実行)で次を確認する。

- `docs/articles/*.html`の件数が408のまま増えない(`articles-data.json`の件数も408)
- 日次実行で`git diff`が空になり、botのcommitが作られない(`pushed=false`)
- 検索公開試験5ページ(`grain-free-dog-food.html`含む)のblobが変化しない
- `sitemap.xml`の`lastmod`・`sitemap-lastmod.json`が変化しない
- ワークフローが成功し、`check-links.js`が通る
- `npm test`・`npm run strategy:validate`が通る

## Success Criteria

- 日次処理を実行しても新しい`docs/articles/*.html`が増えない(408のまま)
- 既存408商品記事は維持され、検索公開試験5ページの差分は0
- サイト生成・`sitemap.xml`・テストが正常
- 定数の切り替えだけで再開できる

## Kill Criteria

- 日次ワークフローが失敗する、または`docs/`が意図せず変更された場合 → 即時revert
- 停止の副作用(日次メールの停止など)が運用上の問題と判断された場合 → 定数をfalseに戻す、または別方式を検討する

## Rollback Plan

`ARTICLE_GROWTH_FROZEN`を`false`にするPR、または該当コミットのrevert。停止中は`posted-history.json`・`articles-data.json`・既存記事を一切変更しないため、元に戻す際に復元すべきデータはない。再開すると、停止中に候補だった商品が通常どおり選定され、記事が再び増え始める。

## 将来の再開の設計

- 再開の判断は、収益性の高いテーマが確定した時点で、ユーザーが決める(例: 特定のテーマ・キーワードに絞った再開は、`select-products.js`の枠・キーワードの見直しを含む別Briefにする。本Briefでは全面再開(定数をfalse)しか扱わない)
- 再開前に確認すること: 楽天APIの認証情報の有効性、楽天Web Serviceの規約(定期的なAPI利用に関する条件。Brief `brief-2026-10-13-product-data-freshness-disclosure`のBLOCKER参照)、再開後に増やす記事の方針(本数・テーマ・品質基準)

## Required Tests

- 定数がtrueのとき: `select-products.js`が、楽天の環境変数が未設定でも終了コード0で終わり、`selected-products.json`・`posted-history.json`・`api-errors.log`を作成・更新せず、ネットワークアクセスをしない(`fetch`を呼ばない)こと
- 定数がfalseのとき: 従来の動作に戻る(環境変数が未設定なら従来どおり非ゼロで終了する)こと。テストでは、コピーしたファイルの定数を書き換えて検証する
- 停止状態を再現: `selected-products.json`が登録済み商品のみのとき、`generate-site.js`を実行しても`articles-data.json`の件数・`docs/articles/`の件数が増えないこと(既存挙動の回帰確認)
- 既存の`generate-site*.test.js`・`sitemap-lastmod.test.js`・`product-data-freshness.test.js`が通ること
- `npm run strategy:validate`、`npm test`

## 実装PRが必要か

必要。コード変更(`select-products.js`の定数と分岐)とテスト追加を伴う。実装前にユーザーの承認を得る。本Briefは判断材料の整理のみ。

## Required Report

停止前後の`docs/articles/`件数 / 日次実行の差分有無・commit有無 / 対象LPと検索公開試験5ページの差分 / 副作用の確認結果(メール・API監視) / テスト結果 / PR番号
