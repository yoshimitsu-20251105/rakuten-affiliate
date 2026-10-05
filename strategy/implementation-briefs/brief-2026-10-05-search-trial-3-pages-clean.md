# Implementation Brief

## ID

brief-2026-10-05-search-trial-3-pages-clean

## Objective

新規検索流入テスト3ページ(grain-free-dog-food / senior-cat-food / domestic-additive-free-dog-treats)を、不要な大量差分なし・検索意図に合った商品・比較する意味のある情報・正確な表現・GA4/affiliate_click計測維持の状態で、PR #17の置き換えとして再構成する。

## Business KPI

Organic Search Impressions / Organic Search Clicks / Affiliate CTR / Affiliate Clicks / Revenue(`strategy/experiments.json` の `exp-2026-10-05-*` 3件で追跡)

## Hypothesis

既存2ページ(senior-dog-pork / grain-free-cat-food)と異なる検索需要を持つ3テーマについて、検索意図に適合した専用比較ページを公開することで、30日以内にSearch Console impressionsを取得できる。ただし「impressionsが出れば収益化成功」とは扱わない(impressionsはファネルの最上流にすぎない)。

## Evidence

- Google Keyword Planner実データ(`keyword-research/output/gkp-runs/phase3a-live-2026-09-07-01/`): 3テーマとも月間検索数・SAFE/VALID判定済み(FACT)
- 楽天ライブAPIでの在庫・属性再確認(FACT、本ブリーフ実装時点)
- 既存2ページの実測(`exp-2026-09-10-*`、2026-09-30観測): senior-dog-porkはimpressions=1を獲得済み。グレインフリー猫食はまだ0(FACT)

## Counter Evidence

- `select-products.js` の既存キーワード(2026-08-28追加分)と概念的に重複する可能性がある(`strategy/decisions.json` の `dec-2026-10-04-cannibalization-proceed` 参照)
- PR #17の旧実装は、商品適合性・表現・比較情報の質に改善余地があった(本ブリーフの主目的)

## Scope

- 新規3ページ(docs/rankings/配下)の作成・公開(canonical/meta description/GA4/affiliate_click維持)
- 商品選定の再精査(検索意図との適合性優先)
- 比較表・ページ構成の改善(ページ固有のmeta description、客観的な比較項目の追加、「人が確認した」表現の削除、恣意的な順位表現の見直し)
- 新規3ページへの最小限の内部リンク(関連する既存ページへの手動での小さな追記、サイト全体の再生成はしない)
- `keyword-research/search-trial-pages.json` への3件追加

## Files Allowed To Change

- `docs/rankings/grain-free-dog-food.html`(新規作成)
- `docs/rankings/senior-cat-food.html`(新規作成)
- `docs/rankings/domestic-additive-free-dog-treats.html`(新規作成)
- `docs/rankings/petfood-sougou.html`(内部リンク追記のみ、最小限)
- `docs/rankings/国産_無添加_ドッグフード.html`(内部リンク追記のみ、最小限)
- `docs/rankings/all.html`(特集ページへのリンク追記のみ、最小限)
- `docs/sitemap.xml`(新規3URLの追加のみ、他エントリは変更しない)
- `keyword-research/search-trial-pages.json`
- `keyword-research/publication-attributes.js`
- `keyword-research/publication-approval.js`(product-level/page-levelの追加フィールド)
- `keyword-research/publication-preview-build.js`
- `keyword-research/publication-preview-template.js`
- `keyword-research/test/*`(関連テスト追加・更新)
- `strategy/experiments.json`(PLANNED維持、本番公開確認後にRUNNINGへ)

## Files Not Allowed To Change

- `docs/articles/`配下(全件)
- `docs/index.html`
- `docs/robots.txt`
- `docs/rankings/senior-dog-pork.html`、`docs/rankings/grain-free-cat-food.html`(既存コントロールページ)
- `docs/rankings/`配下のその他全ジャンルページ(上記3件の最小限追記対象を除く)
- `generate-site.js`
- `select-products.js`
- `.github/workflows/`配下
- affiliate URL(affiliateUrlそのものの改変)

## Implementation Requirements

- 既存の公開パイプライン(prepare-publication-review → enrich-publication-products[live] → build-publication-preview → publish-approved-pages)を再利用する
- `generate-site.js` は実行しない(docs/articles/・他ランキングページの一括再生成を避けるため)。内部リンク・sitemapは対象ファイルのみを直接の最小差分で編集する
- 商品は実際の検索意図(グレインフリー表記/シニア対象年齢/国産・無添加表記)に適合するものを優先し、適合しない場合は候補から除外または明確な注記を付ける
- 「人が内容を確認して選定しました」等、個別検証の実態がない表現は使わない
- 医療・健康効果の断定表現は使わない(safety gate必須)
- 比較表の項目は、確認できないものは省略する(推測で埋めない)
- 順位は客観的な基準(例: レビュー件数)を明示できる場合のみ使い、恣意的な「おすすめ順」にしない

## Measurement Plan

`keyword-research/cli/search-trial-report.js`(安全ゲート付きCLI)で、Search Console/GA4を2026-10-10以降に定期観測する。`strategy/experiments.json` の `exp-2026-10-05-*` へ記録する。

## Success Criteria

reviewDate(本番公開日+30日、公開確定後に設定)までに、各ページでSearch Console impressionsが累計5件以上。

## Kill Criteria

reviewDateまでにimpressionsが累計0件のまま。

## Rollback Plan

新規3ページ・内部リンク追記・sitemap追加はすべて新規追加/小規模追記のみであり、問題があれば該当箇所を個別にrevertすれば既存ページへの影響はない(既存2ページ・他ジャンルページ・docs/articles/は変更していないため)。

## Required Tests

- `npm run strategy:validate`
- `npm test`(既存テストを壊さない。新規3ページ向けのテストを追加: noindexなし/self canonical/GA4/affiliate_click/PR表記/内部リンク/商品数1件以上/医療表現なし)

## Required Report

branch名・新PR番号・changed files数・additions/deletions・docs/articles変更数・日付だけ変更されたファイル数・新規3ページURL・各ページの商品数と入替内容・meta description・比較項目・独自価値・内部リンク元・sitemap変更内容・GA4/affiliate_click確認・canonical/noindex確認・medical claim検査・validate/test結果・新PRのmergeable状態・PR #17を閉じてよいか
