# CURRENT_STATE

> プロジェクト全体の「今どうなっているか」だけを表示する1ファイル。過去の履歴を大量に書かない(履歴は `daily-reports/`・`decisions.json`・`experiments.json` を参照)。新しい調査・実装を始める前に、必ずこのファイルを確認すること(CLAUDE.md参照)。

## Last Updated

2026-10-05

## Primary Goal

記事数・ページ数・コード量・自動化率ではない。Revenue / Approved Revenue / Profit / EPC / Conversion Rate / Affiliate CTR / Organic Traffic を持続的に増加させること(CLAUDE.md参照)。

## Current Revenue Status

FACT(GitHub由来、CLAUDE.md「運用状況」セクション、2026年8月時点の記録): 収益はまだ発生していない(公開直後のため、インデックス反映待ち)。この記録以降、本リポジトリ内で収益額を更新した記録はない。**現時点の正確な収益額はUNKNOWN**(楽天の管理画面側のデータであり、リポジトリからは確認できない)。

## Current Traffic Status

「最後に確認できた実測値」として記録する(GSC/GA4由来のFACT、取得日時つき。外部データだからという理由だけでUNKNOWNに戻さない)。詳細・出典は `strategy/experiments.json` の各experimentの `metrics[]` を参照。

| ページ | 観測日 | Search Console impressions | clicks | avg position | URL Inspection | GA4 sessions | GA4 views | affiliate_click |
|---|---|---|---|---|---|---|---|---|
| senior-dog-pork.html | 2026-09-30 | 1 | 0 | 13 | Submitted and indexed | 8 | 9 | 0 |
| grain-free-cat-food.html | 2026-09-30 | 0 | 0 | - | URL is unknown to Google | 9 | 9 | 0 |

出典: google_search_console_data_api / google_search_console_url_inspection_api / ga4_data_api(いずれも `keyword-research/cli/search-trial-report.js` の安全ゲート付きCLI経由)。2026-10-05時点でこれより新しい観測は未実施(UNKNOWN)。

PR #17(未マージ)の新規3ページ(grain-free-dog-food / senior-cat-food / domestic-additive-free-dog-treats)は本番未公開のため、トラフィックデータは存在しない(UNKNOWNではなく「まだ観測対象ではない」)。

## Active Experiments

`strategy/experiments.json` 参照。

**RUNNING(本番公開済み)**:

- `exp-2026-09-10-senior-dog-pork` — startDate 2026-09-10 / reviewDate 2026-10-10
- `exp-2026-09-10-grain-free-cat-food` — startDate 2026-09-10 / reviewDate 2026-10-10

**PLANNED(PR #17未マージのため未公開。startDate/reviewDateは本番公開後に確定)**:

- `exp-2026-10-05-grain-free-dog-food`
- `exp-2026-10-05-senior-cat-food`
- `exp-2026-10-05-domestic-additive-free-dog-treats`

## Active PRs

GitHub上で確認できる事実(2026-10-05時点、OPEN状態のみ):

- PR #16 `feature/instagram-auto-post` — Instagram自動投稿機能(Secret未設定の間は下書きモード)。承認済みのImplementation Briefがないため、**MERGE RECOMMENDATION = HOLD**(内容の変更・クローズはしていない)
- PR #17 `feature/search-trial-3-new-pages` — 新規検索流入テスト3ページ。**未マージのため、master/本ブランチの`docs/`・`keyword-research/search-trial-pages.json`にはまだ反映されていない**
- PR #18 `feature/affiliate-agent-operating-system` — 本ファイルを含むAI Agent Operating System基盤(このPR自体)

## Current Opportunities

- `senior-cat-food-jp`(`strategy/opportunities.json`): status TEST

## Known Problems

- FACT: `docs/sitemap.xml` のSearch Console取得失敗問題について、診断用の最小サイトマップ(`docs/sitemap-test.xml`、PR #15でマージ済み)を追加して切り分けを行った。現時点で問題自体が解決したという記録はリポジトリ内にない
- FACT: `select-products.js` に2026-08-28時点で設定済みのキーワード(グレインフリー 国産 ドッグフード/シニア猫 国産 無添加/国産 無添加 犬 おやつ等)と、PR #17の新規3ページが概念的に重複している(`strategy/decisions.json` の `dec-2026-10-04-cannibalization-proceed` 参照)

## Current Hypotheses

- `strategy/opportunities.json` の `senior-cat-food-jp.hypothesis` 参照
- `strategy/experiments.json` の各experimentの `hypothesis` 参照

## Confirmed Learnings

- (まだ確定した学びはない。実験レビュー完了後に `strategy/experiments.json` の `learnings` へ追記する)

## Rejected / Falsified Ideas

- (まだなし)

## Top 3 Priorities

1. PR #17・PR #18のレビュー・マージ判断
2. マージ後、`exp-2026-10-05-*` の3実験をPLANNED→RUNNINGへ更新(実公開日をstartDateに記録)
3. 2026-10-10(既存2実験のreviewDate)に向けたSearch Console/GA4の再観測準備

## Waiting For

- PR #17・PR #18ともに人間のレビュー・マージ待ち

## Next Review

**2026-10-10**(`exp-2026-09-10-senior-dog-pork` / `exp-2026-09-10-grain-free-cat-food` のreviewDate。既存の本番公開済み実験が優先)

次点: 2026-11-04(PR #17マージ・公開後、新規3実験のreviewDateが startDate+30日 で確定する想定)
