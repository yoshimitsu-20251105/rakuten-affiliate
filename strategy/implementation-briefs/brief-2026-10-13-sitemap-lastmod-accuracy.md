# Implementation Brief

## ID

brief-2026-10-13-sitemap-lastmod-accuracy

## Objective

`docs/sitemap.xml` の `<lastmod>` を「ページに実質的な変更があった日」だけが更新される値にする。現状は全URLが毎日一律で当日日付に更新されており、Googleが `lastmod` を信頼できる値として使えない状態になっている。

## Business KPI

Traffic(Googleによる発見・再クロールの効率)。Revenueに直結する改善ではなく、検索経由の流入を測れる状態を作るための計測・発見面の修正。

## Hypothesis

HYPOTHESIS: 全URLの `lastmod` が毎日一律に更新される状態を解消すると、Googleが `lastmod` を再クロールの判断材料として使える。ただし、これが「sitemapの処理待ち(isPending)が3週間以上続く」「対象4URLが未クロール」の原因かどうかは確認できておらず、この修正で索引状況が改善するとは約束しない。

## Evidence

2026-10-13時点の調査(コード・git履歴・公開sitemapの実測):

- FACT: `generate-site.js` の `sitemapXml()` は全URLに `TODAY_ISO`(生成日)を一律で出力する(`generate-site.js:556`)。lastmodの元データは生成日であり、ページ内容やgit上の変更日は参照していない
- FACT: 公開中の `sitemap.xml` は430URL全てが `lastmod=2026-10-12` で、リポジトリ版と内容が一致する。日次ワークフロー(毎日22:07 UTC)が毎回ファイルを書き換えてコミットしている
- FACT: 日次コミット(10-12)でdocs配下の約408ファイルが変更されるが、記事ページ・ランキングページの差分は「情報取得日」「最終更新日」の日付文字列だけだった。日付文字列以外に変更があったページは10-12は0件、10-11は1件、10-10は3件(新規追加は別に0〜4件)
- FACT: 過去の累計でも、変更行76,849行のうち63,479行(約83%)は日付文字列のみの変更
- FACT: `articles-data.json` は新規商品の追記のみで、既存商品のデータは更新されない(`generate-site.js` の追記ロジック)。一方、ページ上の「情報取得日」は実際の取得日ではなく生成日が表示される(`generate-site.js:299`)。この表示の問題は本Briefの範囲外(後述)

## Counter Evidence

- Googleは `lastmod` が検証可能な形で正確な場合に利用し、不正確な場合は無視する、という扱いと理解している。したがって、現状の不正確な `lastmod` は「悪影響を与える」というより「効果がない」可能性が高い(ESTIMATE。Google側の実際の挙動はUNKNOWN)
- sitemapは `isPending: true` のまま3週間以上処理待ちで、エラー・警告は0件(2026-10-10確認)。この状態が `lastmod` に由来するという根拠はない(UNKNOWN)
- 修正しても対象4URLが索引される保証はない

## Scope

- `lastmod` を、ページの実質的な内容が変わった場合のみ更新する仕組みにする
  - 各URLのHTMLから日付文字列(`情報取得日:` / `最終更新日:`)を除いたハッシュを計算する
  - ハッシュが前回と同じなら前回の `lastmod` を維持し、異なる、または新規URLなら当日日付にする
- 前回のハッシュと `lastmod` を、リポジトリ直下の `sitemap-lastmod.json` に保存する(`articles-data.json` と同じ場所。日次ワークフローは `git add -A` のため追加の設定変更は不要)
- 初回(`sitemap-lastmod.json` がない場合)の扱い:
  - FACT: 既存URLの正確な過去の更新日は復元できない。現在の`docs/sitemap.xml`の`lastmod`(2026-10-12)は実更新日ではなく、日次生成の実行日が全URLに一律で入った不正確な値である
  - 方針: 誤った`lastmod`を引き継がない。旧`sitemap.xml`の`lastmod`の値は読まない
  - 初回実行の判定は、書き込み前の旧`docs/sitemap.xml`の`<loc>`一覧だけを使う
    - 旧sitemapに載っているURL(PR #28導入前から存在するURL): `lastmod`を`null`として記録し、`sitemap.xml`では`<lastmod>`を省略する
    - 旧sitemapに載っていないURL(初回実行中に新しく生成されたURLを含む): 生成日を`lastmod`として付与する
    - 旧sitemapが存在しない場合は、全URLが新規として生成日になる
  - 2回目以降は`sitemap-lastmod.json`のハッシュ方式のみを使う(旧sitemapは参照しない)
  - 以後、実質的なHTML内容が変更されたURLだけ、変更日を`lastmod`として付与する。新規URLは生成日(=作成日)を`lastmod`として付与する
  - (2026-10-13のユーザー判断により、当初案の「現在の`lastmod`を引き継ぐ」から本方針へ変更し、正式採用した。初回実行中に追加されたURLまで`null`になる不整合は、レビューで指摘されて修正した。実装はPR #28)
- 検索公開試験ページ(`search-trial-pages.json` 掲載)も同じ方法で扱う。ページファイルが変わらない限り、`lastmod`は省略のまま(`null`を維持)で、毎日更新しない

## Files Allowed To Change

- `generate-site.js`(`sitemapXml()` と、その補助関数の追加のみ。実装では`sitemapXml()`を`sitemapUrls()`と`sitemapXml()`に分割し、sitemapの書き込みを全ページ書き込み後へ移動した)
- `lib/sitemap-lastmod.js`(新規。実装中に必要性が判明して追加。`generate-site.js`はimportするとmain()が実行されるため単体テストできず、ハッシュ計算・lastmod決定・記録の読み込みを純粋関数として切り出す必要があった。既存の`generate-site-search-trial.test.js`の隔離テスト方式が`lib/`をコピーするため、同じ場所に置いた)
- `sitemap-lastmod.json`(新規)
- `keyword-research/test/` 配下の関連テスト(新規または既存テストの追加)
- `docs/sitemap.xml`(日次パイプラインによる再生成)

## Files Not Allowed To Change

- `docs/rankings/grain-free-dog-food.html`(Traffic Acquisition Experiment 1の対象LP。本文・title・CTA・商品・affiliate URLを含め変更禁止)
- `docs/articles/` および `docs/rankings/` 配下のページ本文(「情報取得日」「最終更新日」の表示も本Briefでは変更しない)
- `docs/index.html`、`docs/robots.txt`、`docs/sitemap-test.xml`
- `keyword-research/search-trial-pages.json`、`select-products.js`、`.github/workflows/`
- `articles-data.json`、affiliate URL

## Implementation Requirements

- ハッシュ計算とlastmod決定は純粋関数に切り出し、テスト可能にする
- 日付文字列のみが変わったページは `lastmod` が変わらないこと
- HTMLに実質的な差分(例: 関連商品リンクの追加)があったページは `lastmod` が当日になること
- `sitemap-lastmod.json` が壊れている場合は `generate-site.js` が非ゼロ終了し、`docs/` を変更しないこと(既存の検索公開試験設定と同じfail closedの方針)
- 外部ライブラリを追加しない(Node標準の `node:crypto` を使う)

## Measurement Plan

- 修正後の日次コミットごとに、`docs/sitemap.xml` で `lastmod` が変わったURL数を数える。日付文字列以外に変更のあったページ数(新規ページを含む)と一致すること
- 日次で`lastmod`が付くURL数は一定ではない。FACT(実データの隔離コピーで確認): 新商品1件の追加で、同じ`matchedKeyword`の既存記事の「関連商品」欄(`relatedProductsBlock()`: 同一`matchedKeyword`のスコア上位3件を表示)に新商品が入ると、そのグループの既存記事のHTMLが実際に変わる。高スコアの新商品(レビュー500件・評価4.9)を既存グループ(36記事)に追加した場合は、新規記事1、関連商品欄のみ変更36、`index.html`・`rankings/all.html`・グループのランキングページの3、計40URLに`lastmod`が付いた。スコアの低い新商品(レビュー10件・評価3.9)の場合は計4URL(新規記事1+上記3)だった。これらは日付文字列だけの変更ではなく、リンク先・表示商品が実際に変わる実質的なHTML変更であるため、`lastmod`の更新対象として正常である
- 公開sitemapの `lastmod` が、全件一律(1種類・全URL)から、初回は導入前から存在するURLが全て省略(初回実行中に生成された新規URLだけ生成日)に変わり、以後は内容が変わったURLと新規URLだけに付くこと
- Search Consoleの `sitemaps.list` の状態(`isPending`、`lastDownloaded`、`errors`)を修正前後で記録する。ただし、これは参考情報であり成功条件ではない

## Success Criteria

- 修正後、日次で `lastmod` が変わるURLが、実質的な変更があったページに限られる(全430件が毎日変わる状態が解消される)
- 日付文字列のみ変更されたページの `lastmod` が維持される
- `npm test` と `npm run strategy:validate` が通る
- 対象LP `grain-free-dog-food.html` のファイル差分が0件
- 索引状況の改善は成功条件に含めない

## Kill Criteria

- 修正後に `docs/` の記事・ランキングページ本文が意図せず変更された場合 → 即時revert
- 日次ワークフローが `sitemap-lastmod.json` 関連で失敗した場合 → revertして原因調査

## Rollback Plan

該当コミットをrevertする。`sitemap-lastmod.json` は削除する。revert後は従来どおり全URLが当日日付で出力される(現状の動作に戻るだけで、公開ページへの影響はない)。

## Required Tests

- `npm run strategy:validate`
- `npm test`(ハッシュ維持・更新・新規URL・日付文字列のみの変更・マニフェスト破損時のfail closedを追加)
- 修正後の最初の日次実行で、`git diff --stat -- docs/` の変更ファイル数が従来(約400)より大幅に減ること

## Required Report

実装前後の `lastmod` 種類数 / 日次で `lastmod` が変わったURL数 / 変更ファイル一覧 / テスト結果 / 対象LPの差分有無 / PR番号

## Out of Scope(別途判断が必要)

- 「情報取得日」「最終更新日」の表示が、実際の商品データ取得日ではなく生成日になっている問題(FACT)。403記事は追加時点(最大約56日前)のデータのままで、表示は毎日「今日」になる。ユーザーに誤解を与える可能性があり、Googleの品質評価の観点でもリスクになりうる。記事本文403件が変わるため、本Briefとは分けて判断する
- 一括noindex、記事の削除、サイト構造の変更
