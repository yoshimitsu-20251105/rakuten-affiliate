# シニア猫フード内部リンクの公開検証

2026年11月28日 19:07:36 JST に GitHub Actions の公開 HTML 検証ステップが成功した。時刻は GitHub のステップ完了時刻（10:07:36 UTC）。

- 実行は **Verify public Pages #1**、実行 ID `46133660799`、ジョブ ID `140944115120`。[実行結果](https://github.com/yoshimitsu-20251105/rakuten-affiliate/actions/runs/46133660799) · [ジョブ詳細とログ](https://github.com/yoshimitsu-20251105/rakuten-affiliate/actions/runs/46133660799/job/140944115120)
- 手動起動の対象は `master` の `fbb828b454c0366c4844e6ca22ca6b6f7c94a4c3`。Workflow は固定 URL を直接取得し、両方の HTTP 200 と承認済み SHA-256、HTML 内の対象リンクが1本あり承認済み URL へ解決されることを必須としている。ジョブログに両ファイルの `OK` が記録された。

| 公開 URL | HTTP | 承認済みの SHA-256 |
| --- | --- | --- |
| [petfood-sougou.html](https://yoshimitsu-20251105.github.io/rakuten-affiliate/rankings/petfood-sougou.html) | 200 | `cc45ae4242c317e1895f6edc923161332115cb2de4daba48bf80e3111e7a7acf` |
| [senior-cat-food.html](https://yoshimitsu-20251105.github.io/rakuten-affiliate/rankings/senior-cat-food.html) | 200 | `ea2ab4e8a27455128dc1b12779d3ae33a26d2432e8a967f41e791a2d6bf95917` |

リンクは `petfood-sougou.html` から `senior-cat-food.html` へ解決される。検証は HTTP 取得のみで、ページの計測タグは実行していない。

## 実験開始の確認

- 公開確認条件は成立。既存のシニア猫検索流入テストは `INCONCLUSIVE` で終了済み。今回の施策の開始日と開始承認は未確定。
- 登録台帳の `RUNNING` 検証は開始日と対象URLを要求する。GA4・楽天の基準値が UNKNOWN であることだけを一律の開始拒否条件とする規則は確認できなかった。対象指標の前後比較や収益判定には、基準値と帰属の確認が必要。
- 11月26日を対象とした Google WIF 検証は認証が成功し、GSC 行を受信した。GA4 Organic Search と affiliate_click は空応答。集計は失敗したため、開始判定に使える新しい計測結果は未確定。[WIF 実行結果](https://github.com/yoshimitsu-20251105/rakuten-affiliate/actions/runs/46133742904)
- **Day 0 は未確定**。開始承認と開始条件の確認後の実日付を使う。11月27日の QA と変更前の8表示は変更後KPIから除外する。正式計測は2026年12月12日までに再検証する。
