# 実験別の日次集計

`node experiment-measurement/cli.js /private/experiment-input.json` で読み取り専用の JSON レポートを標準出力へ生成する。入力と結果は非公開領域に保存する。ネットワーク取得やスケジュールは別途設定する。

入力は `experimentId`、`targetUrl`、`startDate`、`endDate`、`day0`（未確定なら null）、`asOf`（当日）、`rows`（日次データ）。日付は YYYY-MM-DD。各行には `date` と、確認できた指標 `impressions`、`clicks`、`averagePosition`、`organicEngagedSessions`、`affiliateClicks`、`conversions`、`approvedRevenueJpy` を記載する。楽天成果は対象に帰属できた値のみ入力する。欠測値は省略または null。取得元で確定日が分かる場合は `finalThrough` に指標名と日付を指定する。基準値は `baseline` に `startDate`、`endDate`、`impressions`、`clicks` を指定する。

日次データは Search Console と GA4 のエクスポート、または既存読み取りアダプターの結果を対象URL・日付単位で正規化する。日付境界はデータソースのタイムゾーンを確認してから比較する。楽天公式 CSV は既存 funnel importer で先に検証する。日次の帰属を確定できない成果を推定配賦しない。

出力は昨日、直近7日、指定期間、Day 0 以降累計、チェックポイント、欠損・確定待ち・QA除外の日付。基準値との比較は対象期間の日数あたりの表示・クリックを比較する。Day 0 未確定時は開始後累計と比較差分を生成しない。判定は HOLD とし、閾値の評価や変更は承認済みの実験レビューで行う。
