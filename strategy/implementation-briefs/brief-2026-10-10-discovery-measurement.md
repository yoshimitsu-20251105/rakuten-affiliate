# Implementation Brief: 登録障害の切り分けと日次計測

## ID / Authorization

brief-2026-10-10-discovery-measurement。2026-10-10ユーザー指示「サイトがGoogleに認識されないというのが問題。早く自動化・収益化の設定を構築して…検証反証に入りたい」に基づく限定実装。

## Objective / Business KPI

未登録ページが検索評価に乗る状態を作り、Organic Clicks → Affiliate Clicks → Conversions → Approved Revenueを検証する。今回の実装は発見経路と計測を担当する。登録や利益の増加を保証しない。

## Evidence / WHY_REVISIT

- FACT: PR #23の2026-10-10記録ではsenior-dog-porkとall.htmlは索引済み、他4検証URLは登録未確認。サイト全体が未認識という説明は不正確。
- FACT: 現masterの日次処理は商品選定・サイト更新であり、GSC/GA4計測は日次処理に入っていない。
- FACT: masterのトップページに5検証URLへの直接リンクはなかった。all.html経由で到達する。
- UNKNOWN: 未登録の確定原因。robots/canonicalが正常でも品質・重複・サイト評価は除外できない。
- WHY_REVISIT: 診断を繰り返すのではなく、ユーザーの優先方針に従い、発見経路の改善と既存計測の定期実行を追加する。

## Hypothesis / Counter Evidence

HYPOTHESIS: トップからの直接リンクは発見経路を短縮する。日次計測により未登録・取得不能・流入不足を区別できる。

反証・リスク:
1. 内部リンクを足してもGoogleが登録を選ぶとは限らない。
2. 登録済み犬記事でも表示1回という記録があり、登録だけでは需要・検索意図・品質問題は解決しない。
3. 楽天成果データは未接続。クリックだけ増えても収益化成功と判定できない。

一次資料:
- https://developers.google.com/search/docs/crawling-indexing/ask-google-to-recrawl
- https://developers.google.com/search/apis/indexing-api/v3/quickstart

一般記事をGoogle Indexing APIで強制登録する設計は採用しない。登録リクエストはSearch ConsoleのURL検査画面から行う。反復リクエストは登録の高速化を保証しない。

## Scope / Files Allowed To Change

- generate-site.js / docs/index.html: internalLinkEnabledの対象をトップから直接リンク。
- keyword-research/daily-measurement.js / cli/daily-measurement.js / test/daily-measurement.test.js
- keyword-research/test/generate-site-search-trial.test.js
- .github/workflows/daily-measurement.yml
- 本Brief

## Files Not Allowed To Change

既存記事本文・title/H1、商品選定、日次公開workflow、experiments.json/decisions.jsonの既存判定、PR #23。

## Implementation Requirements / Activation

1. GitHub Repository Settings → Secrets and variables → Actionsに、Secret `GA_SEARCH_CONSOLE_SERVICE_ACCOUNT_JSON`を登録。既存GSC/GA4読み取り用サービスアカウントJSONを利用し、本文・PR・ログへ貼らない。
2. 同画面のVariablesで`SEARCH_TRIAL_DAILY_ENABLED=true`を設定。
3. PRマージ後、Actions「日次の登録状況・収益導線計測」→ Run workflowで実行。以後08:37 JSTに予定実行(開始時刻の厳密保証はない)。
4. 実行結果のSummaryとArtifactsを確認。Google権限不足やSecret未設定は失敗として扱い、ゼロ件に置換しない。
5. 無人実行成功を確認するまでAutomation Readiness=READYとは記録しない。

この環境に認証鍵はない。実測取得・Secret登録・本番無人実行は未完了。コード完成と稼働完了を混同しない。

## Measurement Plan / Decision Gates

- 全5検証URLを毎日監視。GSC/GA4は3日前までの累計を要求、登録状況は取得時点。3日の余裕はデータ確定の保証ではない。
- 既存CLIの`dataLastAvailableDate`は要求終了日をそのまま返すため、実際の確定最終日とは扱わない。確定判定は別途確認が必要。
- 登録未確認: 記事収益性のKILL判断を保留し、URL検査の公開テスト・登録リクエスト・発見経路を確認。
- 欠損データ: UNKNOWNを維持し、計測接続を改善。
- 全対象のreviewDate+3日を過ぎたら自動で期間を延長せず、エラーでレビューを要求。
- 重複する日次累計を足し合わせない。新規3URLの評価は各公開日以降を個別集計する。
- 初売上・確定報酬は楽天管理画面/エクスポートで確認。売上のサイト単位集計を各記事へ配分して捏造しない。

## Success / Kill Criteria

今回の技術完了条件: 日次再生成でトップの直接リンクが保持される、安全ゲート付きの計測が無人で完了し結果が保存される。利益増加の成功条件とは分ける。

提案する次の検証: 公開反映・登録リクエスト実施日をDay0として7日後と14日後に登録状況を比較。未登録が続く場合はリンク施策の十分性を反証し、品質・重複・クロール状況を再調査する。即時のページ削除はしない。収益施策の数値閾値は流入母数と楽天成果の取得後に決める。

## Rollback / Required Tests / Required Report

変化が悪化した場合は当PRをrevert、監視を止める場合はVariableをfalseにする。記事本文・成果台帳に自動書き込みしない。

Required tests: トップ・all.htmlの相対リンク、internalLinkEnabled=false、日次再生成、JST日付・期間終了、欠損と実測ゼロの区別。npm test / npm run strategy:validate。

Required report: PR URL、テスト結果、未実施の認証/無人実行/登録リクエスト、日報追加候補、実験候補。本Brief自体は過去台帳の上書きを行わない。

日報追加候補: 発見経路を短縮し日次計測コードを追加、稼働はSecret/Variable・マージ・初回実行待ち。
実験追加候補: 上記Day0から14日間の登録改善検証。公開日が未確定のため開始日を仮の日付で埋めない。
