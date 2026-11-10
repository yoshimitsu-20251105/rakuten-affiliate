# 日次workflowの公開停止・検証専用化（2026-11-10）

起点: `a58d2d0579b7b81b2bd4dc88f15e08272dd5a693`。専用ブランチのみで変更する。
masterへマージされるまでは、現在のmaster上の日次公開経路は止まらない。
この変更はGitHub Secrets / Variables / Pages設定を変更しない。

## 変更前の実行経路

全ステップがPublishing Safety Layer未接続だった。

| 処理 | 読取専用 | working tree変更 | push / Pages / 外部送信 |
|---|---|---|---|
| checkout / setup-node | 環境準備 | checkoutとランタイム | GitHub・ランタイム読取 |
| select-products.js | いいえ | selected-products.json / posted-history.json / api-errors.log | 楽天APIへの要求 |
| generate-site.js | いいえ | docsの記事・ランキング・LP、articles-data.json、sitemap-lastmod.json等 | 後続pushからPagesへ |
| generate-social-posts.js | いいえ | social-posts.txt | 投稿自体はしない |
| check-links.js / ログ検査 | はい | なし | なし |
| git add / commit / push | いいえ | index / Git履歴 | GitHub pushからPagesへ |
| Pagesビルド確認 | はい | なし | GitHub API読取 |
| エラー・更新完了・失敗メール | いいえ | なし | SMTPによる外部送信 |

## 変更後

schedule（07:07 JST）とworkflow_dispatchは同じ検証専用jobを実行する。
`contents: read`, `pages: read`、checkoutは`persist-credentials: false`、履歴検証のため`fetch-depth: 0`。
write権限、Secrets参照、商品API、生成器、git書込み、Pages操作、メールactionは存在しない。
checkout / setup-nodeの取得通信とActions自身のログ・Summary保存は基盤処理であり、業務上の外部通知ではない。

既存package.jsonの`npm run strategy:validate`、既存Safetyテスト3ファイル、実験終了テスト、
新しい共通guard・保護対象・workflowテスト、`node check-links.js`を実行する。
日次の試験はリポジトリ読取と専用一時データのみを使い、模擬Git commitを作る既存試験は含めない。
既存試験は削除・skipせず、ローカルの`npm test`で全件実行する。既知のWindows path試験は変更しない。
追加のnpm scriptや依存関係はない。日次の限定試験はNode標準ライブラリだけで動作し、npm installは不要。

workflowはJSON形式（YAML互換）にして、Node標準のJSON parserで全job・step・権限を構造検証する。
隠れたjob、追加run/action、イベント、Secrets、権限変更を拒否する。
旧workflowのhashと新しい検証専用定義だけを許可する限定ルールを共通保護テストへ追加した。
そのテストguard自体も旧・新hashで封印し、既存の他の保護ルールは変えない。
保護対象一覧や記事・LPの期待hashを一括更新しない。

## 状態表示と終了コード

最後の`always()`ステップは`daily-audit/cli.js --checks-status <job.status>`を実行する。
保存済み`reselection-summary.json`と現在の`strategy/experiments.json`のhashを照合する。
非公開の入力・元Learning ledgerがないため、Scanner / Scorer / Selector / Plannerの実データ再実行とは扱わない。

- 推薦0件 + BLOCKED / NO_SELECTOR_RECOMMENDATION: 正常終了し「安全に公開を見送り」と記す。
- 推薦1件 + Planner BLOCKED、将来READY: 生成・公開・投稿の権限はすべてfalse。公開処理はない。
- 欠測、壊れた入力、hash不一致、矛盾した状態: UNKNOWNを維持して非0終了。0やREADYへ変換しない。
- 先行検証失敗・作業ツリー不整合: 非0終了し検証未完了を表示する。公開成功とは表示しない。
- Summaryは既存のGITHUB_STEP_SUMMARYファイルにだけ追記でき、リポジトリ内・symlinkは拒否する。

Publishing Safety Layer本体は変更していない。テスト実行は公開許可の発行ではない。
dry-run専用のSafety Layerに実publisherを接続したと偽らず、生成・公開処理を削除することで到達不能にした。
`AUTO_PUBLISH=true`が外部環境にあっても、このworkflowに公開経路は生じない。
NOTE_NATIVE_MONETIZATION、実験台帳、Learning、既存の監査資料、408記事・LP・CTA・UTM等は変更しない。

## 確認と停止・復旧

cleanなコミット済みチェックアウトで次を実行する（統合テストがcleanを必須とする）。

```sh
npm run strategy:validate
node --test keyword-research/test/daily-workflow-fail-closed.test.js
node check-links.js
node daily-audit/cli.js --checks-status success
npm test
git status --porcelain=v1 --untracked-files=all
```

問題発生時は公開を再有効化せず、監査結果と履歴を保持してレビューする。
旧workflowへrevertすると生成・push・メール経路が復活するため、復旧手段として自動revertしない。
実publisherの追加・設定変更・masterへのマージ・workflow実行は別途承認を必要とする。
