# 日次計測の運用案

レビュー中の Workflow は `experiment-measurement/collect-google-measurement-daily.yml.example`。有効化承認後に `.github/workflows/collect-google-measurement-daily.yml` とし、既存の保護テストには、この Workflow の特定パスと固定ハッシュだけを追加する。リポジトリ変数 `DAILY_MEASUREMENT_ENABLED` は本番承認まで設定しない。起動候補は9:00 JST（0:00 UTC）。GitHub Actionsの環境で遅延がある場合も、取得対象はソース側のカレンダーで決める。

## Google Cloud の設定値

1. プロジェクト `plenary-justice-369508` に専用プール `github-affiliate-daily`、OIDC プロバイダ `github-actions-schedule` を設定する。Issuer は `https://token.actions.githubusercontent.com`、Audience は既定値。属性は `google.subject=assertion.sub` と `attribute.repository_id=assertion.repository_id`。
2. 属性条件を次のように限定する。既存の手動プールと条件は維持する。

   ```cel
   assertion.repository_owner_id == '317599030' &&
   assertion.repository_id == '1336245988' &&
   assertion.repository == 'yoshimitsu-20251105/rakuten-affiliate' &&
   assertion.ref == 'refs/heads/master' &&
   assertion.ref_type == 'branch' &&
   assertion.event_name == 'schedule' &&
   assertion.workflow_ref == 'yoshimitsu-20251105/rakuten-affiliate/.github/workflows/collect-google-measurement-daily.yml@refs/heads/master'
   ```

3. 読み取り用 `website-analytics-reader@plenary-justice-369508.iam.gserviceaccount.com` と保存専用 `website-measurement-store@plenary-justice-369508.iam.gserviceaccount.com` の各サービスアカウント上で、下記プリンシパルに `roles/iam.workloadIdentityUser` を付与する。保存用IDには Google Analytics の権限を付与しない。

   ```text
   principalSet://iam.googleapis.com/projects/461541819464/locations/global/workloadIdentityPools/github-affiliate-daily/attribute.repository_id/1336245988
   ```

4. Cloud Storage API `storage.googleapis.com` と専用バケットを用意する。バケットには公開アクセス防止と均一なバケットレベルアクセスを適用し、保存用IDにそのバケットだけの `roles/storage.objectViewer` と `roles/storage.objectCreator` を付与する。バケット名をリポジトリ変数 `DAILY_MEASUREMENT_BUCKET` に設定する。プロジェクト全体の Storage ロールや削除権限は付与しない。

## 非公開設定と保存

バケットの `config/active-experiment.json` に実験の `experimentId`、`targetUrl`、承認済み `day0`、`approved: true`、確認した `ga4Timezone`、必要に応じて開始前の `baseline` を設定する。これはウェブ公開や実験の状態更新を行わない。初日の完了までは取得を待つ。開始日以降のみを対象とし、接続確認データを種に使わない。

保存先は `daily/<experiment-id>/<YYYY-MM-DD>.json`。同日オブジェクトは作成時の世代番号条件で重複を防止する。新しい取得で従来の過去7日分を置換し、実行漏れがあれば前回基準日まで遡る。GSC は確定済み検索データと、利用可能な場合は未確定開始日のメタデータを取得する。メタデータ取得の暫定行は保存しない。GA4 は直近3完了日を集計保留とする。これは運用上の保守的な待機期間で、Google側の確定を証明しない。GA4 の空応答は UNKNOWN。

レポートは直近7日・28日と各直前の同期間、開始後累計、Day 7・14・28、欠測と確定待ちを含む。未成熟の窓と欠測の差分は null。成功・継続・改善・撤退は人が承認済み閾値と観測を比較して決定し、自動判定は HOLD。日次処理の失敗はジョブ失敗として記録される。GitHub Actions の失敗通知は、利用者の通知設定に従う。ログに出すのは処理状態だけで、データや認証情報は公開リポジトリ、Actions ログ、公開アーティファクトに書かない。

楽天成果は、ユーザーが取得した既存形式の月次公式CSVと取込メタデータを `rakuten/YYYY-MM.json` の `{csv, metadata}` として管理者が非公開で取り込む。設定の `rakuten.reportMonth` で対象月を指定する。ページへの集計には同設定中の `measurementId`、`accountScopeId`、`targetLP`、`exclusiveToLP: true`、`evidenceReference`、`validFrom`、`validThrough` で専用計測IDの適用範囲を確認する。実験開始前を含む月、未帰属、未取込は収益KPIに加算しない。公式CSVの成果は私的レポート内の月次発生日スナップショットとして記録し、日次・商材別・クリックコホートへ推定配賦しない。

## GA4 の追加調査

既存の手動Workflowに `mode` 入力を加え、既存のWIF条件・名前・スコープを保つ案。既定値は既存の接続検証。追加モードはプロパティ `550074703` の確定済み28日間のみで、プロパティ全体・ホスト・対象ページの `screenPageViews`、Organic Searchの `engagedSessions`、`affiliate_click` の `eventCount`、ホスト内のページ別計測、サンプリング・しきい値のメタデータを順に確認する。結果は非公開へ渡し、既存の実験KPIには含めない。現行の固定クエリだけでは実行できないため、このモードの追加と非公開出力先の承認後に実施する。
