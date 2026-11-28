# 日次計測の運用案

レビュー中の Workflow は `.github/workflows/collect-google-measurement-daily.yml`。保護テストでは、承認対象の Workflow の特定パスと固定ハッシュを照合する。リポジトリ変数 `DAILY_MEASUREMENT_ENABLED` は本番承認まで設定しない。起動候補は9:00 JST（0:00 UTC）。GitHub Actionsの環境で遅延がある場合も、取得対象はソース側のカレンダーで決める。

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

バケットの `config/active-experiment.json` に実験の `experimentId`、`targetUrl`、承認済み `day0`、`approved: true`、確認した `ga4Timezone`、必要に応じて開始前の `baseline` を設定する。実験ID・対象URL・Day 0 は [正式開始の追補台帳](../strategy/experiment-reviews/2026-11-29/senior-cat-internal-link-start.json) と一致させる。これはウェブ公開や実験の状態更新を行わない。初日の完了までは取得を待つ。開始日以降のみを対象とし、接続確認データを種に使わない。

保存先は `daily/<experiment-id>/<YYYY-MM-DD>.json`。同日オブジェクトは作成時の世代番号条件で重複を防止する。新しい取得で従来の過去7日分を置換し、実行漏れがあれば前回基準日まで遡る。GSC は確定済み検索データと、利用可能な場合は未確定開始日のメタデータを取得する。メタデータ取得の暫定行は保存しない。GA4 は直近3完了日を集計保留とする。これは運用上の保守的な待機期間で、Google側の確定を証明しない。GA4 の空応答は UNKNOWN。

レポートは直近7日・28日と各直前の同期間、開始後累計、Day 7・14・28、観測済み累計と観測・欠測・確定待ちの日数、完全性を含む。チェックポイントは既存CLIの Day 0 + N の日付を使い、両端を含むため Day 7 は最大8暦日。欠測とQAの扱いはレポートに表示する。未成熟の窓と欠測の差分は null。レビュー日までの表示回数が完全な場合だけ、過去に承認された10表示／反証0表示との比較案を提示する。成功・継続・改善・撤退の決定は人が行い、状態は HOLD のまま。日次処理の失敗はジョブ失敗として記録される。GitHub Actions の失敗通知は、利用者の通知設定に従う。ログに出すのは処理状態だけで、データや認証情報は公開リポジトリ、Actions ログ、公開アーティファクトに書かない。

楽天成果は、ユーザーが取得した既存形式の月次公式CSVと取込メタデータを `rakuten/YYYY-MM.json` の `{csv, metadata}` として管理者が非公開で取り込む。設定の `rakuten.reportMonth` で対象月を指定する。ページへの集計には同設定中の `measurementId`、`accountScopeId`、`targetLP`、`exclusiveToLP: true`、`evidenceReference`、`validFrom`、`validThrough` で専用計測IDの適用範囲を確認する。実験開始前を含む月、未帰属、未取込は収益KPIに加算しない。公式CSVの成果は非公開レポート内の月次発生日スナップショットとして記録し、日次・商材別・クリックコホートへ推定配賦しない。取込失敗は IMPORT_FAILED として Google の保存を継続する。

## GA4 の追加調査

手動 Workflow の `ga4-diagnostics` を選ぶ。データ取得は承認済み。保存経路の有効化には別途承認が必要で、`GA4_DIAGNOSTICS_ENABLED=true`、`GA4_PROPERTY_TIMEZONE`（例 `Asia/Tokyo`。実プロパティ設定を確認）、バケット名を設定する。保存用サービスアカウントに既存手動プールのプリンシパル `principalSet://iam.googleapis.com/projects/461541819464/locations/global/workloadIdentityPools/github-affiliate-pool/attribute.repository_id/1336245988` の Workload Identity User を追加する。既存の手動用プロバイダ条件は維持する。

既定の smoke はこれまでと同じ範囲指定で動く。調査モードの `confirmed_through` はプロパティで確定を確認した最新日を入力する。その日を含む28日間を取得し、直近の完了3日は指定できない。しきい値・サンプリング・行数打ち切りは INCOMPLETE とし、API が提供しない厳密な確定日は断定しない。プロパティ全体→ホスト→対象ページ→Organic Search→affiliate_click→ページ内訳の順に確認する。結果は `diagnostics/ga4/<最終日>.json` に保存し、実験KPIから除外する。

## 設定画面と保存期間

1. [IAM と管理 / Workload Identity Federation](https://console.cloud.google.com/iam-admin/workload-identity-pools?project=plenary-justice-369508) で定期用プール・プロバイダを作成する。
2. [サービス アカウント](https://console.cloud.google.com/iam-admin/serviceaccounts?project=plenary-justice-369508) で指定された保存用アカウントを作り、サービスアカウント単体で所定のバインディングを追加する。キー発行は不要。
3. [Storage API](https://console.cloud.google.com/apis/library/storage.googleapis.com?project=plenary-justice-369508) を確認し、[Cloud Storage](https://console.cloud.google.com/storage/browser?project=plenary-justice-369508) で `plenary-justice-369508-affiliate-measurement` を候補名として、東京 `asia-northeast1`、Standard、公開アクセス防止、均一なアクセスを設定する。保存用IDの閲覧と作成をバケットに限定する。管理者は既存の許可済みアカウントで同画面の `daily/` と `diagnostics/ga4/` を開く。
4. [請求の予算と通知](https://console.cloud.google.com/billing/budgets) で対象プロジェクトを絞り、月500円（請求通貨がJPYの場合）を暫定予算として50/90/100%の通知を設定する。通知先は請求管理者。予算は使用停止を行わない。

保存の初期案は日次・診断90日、CSV原本365日。期限到来処理は管理者の保管方針を別途承認後に設定する。ランナーには削除権限を付与しない。日次1 MiBと仮定すると90件で約90 MiB（約0.09 GiB）。仮に $0.025/GiB月なら保管分は約 $0.0023/月。実際の費用はオペレーション、ダウンロード、通貨、保管先の単価、CSVサイズを含めて初月に確認する。通常の再取得は7日、実行漏れは前回基準日まで遡る。日次集計器の最大366日を超える場合はエラーで停止し、手動の分割取得を別途レビューする。

[Cloud Storage の料金](https://cloud.google.com/storage/pricing) · [予算と通知](https://cloud.google.com/billing/docs/how-to/budgets)
