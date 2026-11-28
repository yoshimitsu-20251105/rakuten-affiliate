# Google WIF 本番接続の検証記録

2026年11月28日、GitHub Actions の `Verify Google measurement with WIF` が、`master` の `3b2177da18d19b59583dcc6530c548dd52d08b24` で成功した。実行 ID は `46135415274`。起動時刻は19:29:30 JST、ライブ取得・集計ステップ完了は19:29:40 JST、実行更新時刻は19:29:43 JST。対象期間は2026年11月26日の接続確認。

| 検証 | 結果 |
| --- | --- |
| WIF と短命トークン発行 | 認証アクション成功 |
| GSC | OBSERVED |
| GA4 Organic Search | NO_ROWS_RETURNED |
| GA4 affiliate_click | NO_ROWS_RETURNED |
| 集計処理・Workflow | 成功 |

集計の本文は公開ログに保存していない。対象 SHA の集計器と回帰テストで、空の GA4 応答は UNKNOWN、判定は HOLD、Day 0 は null になることを確認した。接続確認は変更後の実験KPIから除外する。

公開検証、GSC 基準値、修正後のライブ集計は確認済み。既存の終了済み実験は更新せず、新しい SEO 実験は開始承認後に実際に開始する日を Day 0 とする。GA4 と楽天は現在 UNKNOWN のため、当該指標の比較と収益判定を保留する。11月27日のQAと変更前の8表示は変更後KPIから除外する。正式計測の再検証期限は2026年12月12日。

[GitHub 実行結果](https://github.com/yoshimitsu-20251105/rakuten-affiliate/actions/runs/46135415274) · [ジョブと詳細ログ](https://github.com/yoshimitsu-20251105/rakuten-affiliate/actions/runs/46135415274/job/140949521576)
