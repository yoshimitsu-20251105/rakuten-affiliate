# Google 読み取り専用 WIF の初期設定

## Google Cloud Console

1. プロジェクト `plenary-justice-369508`（番号 `461541819464`）を選択する。「API とサービス → ライブラリ」の「有効な API とサービス」で IAM Service Account Credentials API `iamcredentials.googleapis.com` と Security Token Service API `sts.googleapis.com` が有効か確認する。表示されなければ「ライブラリ」で該当 API を開き「有効にする」を押す。既に設定済みの Search Console API と Analytics Data API はそのまま使用する。
2. 「IAM と管理 → Workload Identity Federation → 対象プールを開く」で、報告済みのプール ID `github-affiliate-pool` を確認する。専用プールとして運用し、別の発行元のプロバイダを追加しない。
3. プロバイダの種類は OpenID Connect、プロバイダ ID は `github-actions`、発行元は `https://token.actions.githubusercontent.com`。対象ユーザー（Audience）は既定値を使う。属性マッピングが以下の4項目になっていることを確認する。

   | Google 側属性 | OIDC の値 |
   | --- | --- |
   | `google.subject` | `assertion.sub` |
   | `attribute.repository_id` | `assertion.repository_id` |
   | `attribute.repository` | `assertion.repository` |
   | `attribute.repository_owner_id` | `assertion.repository_owner_id` |

   報告済みの属性条件は以下の先頭4行に相当する。Google Cloud 側でも今回の専用 Workflow だけに絞る場合は、属性条件全体を以下に更新する。更新後、同じプールを使う既存の連携があれば影響を確認する。

   ```cel
   assertion.repository_owner_id == '317599030' &&
   assertion.repository_id == '1336245988' &&
   assertion.repository == 'yoshimitsu-20251105/rakuten-affiliate' &&
   assertion.ref == 'refs/heads/master' &&
   assertion.ref_type == 'branch' &&
   assertion.event_name == 'workflow_dispatch' &&
   assertion.workflow_ref == 'yoshimitsu-20251105/rakuten-affiliate/.github/workflows/verify-google-measurement-wif.yml@refs/heads/master'
   ```

4. 「IAM と管理 → サービス アカウント → website-analytics-reader → 権限 → アクセス権を付与」。新しいプリンシパルとロールを次の値で登録する。プロジェクト全体の IAM バインディングは不要。

   - プリンシパル `principalSet://iam.googleapis.com/projects/461541819464/locations/global/workloadIdentityPools/github-affiliate-pool/attribute.repository_id/1336245988`
   - ロール `roles/iam.workloadIdentityUser`（Workload Identity ユーザー）

   既存の GSC 制限付きユーザーと GA4 プロパティ `550074703` の閲覧者権限を使う。サービスアカウント鍵、GitHub Secrets、プロジェクトの編集者、Service Account Token Creator の個別付与は不要。

## 承認後の最初の確認

GitHub の「Actions → Verify Google measurement with WIF → Run workflow」で `master` を選ぶ。初回は日付を既定値の 2026-11-26 のまま実行できる。日次データの確認であり、実験の開始や変更後 KPI への加算は行わない。

GitHub OIDC からサービスアカウントの5分の OAuth アクセストークンを発行する。データ API へ渡す OAuth スコープは `https://www.googleapis.com/auth/webmasters.readonly` と `https://www.googleapis.com/auth/analytics.readonly`。トークンと計測値は表示しない。ジョブにはリポジトリの `contents: read` と OIDC 発行用 `id-token: write` だけを指定する。

取得ログの `gsc`、`ga4Organic`、`ga4Affiliate` をそれぞれ確認する。`OBSERVED` はレスポンスに行があること、`NO_ROWS_RETURNED` は正常レスポンスで行がないことを示す。空レスポンスをゼロにしない。401、403、その他の取得失敗は切り分けてログに出し、レポートを確定せずジョブを失敗させる。

## 集計の境界

GSC は対象 URL のウェブ検索で確定済みデータだけを取得する。GA4 は同じページパスの Organic Search engaged sessions と affiliate_click を別々に取得する。GSC の日付は太平洋時間、GA4 はプロパティの日付を保持する。日付をまたぐソース間の帰属には使わない。GA4 の確定日を確認している場合、集計入力の `finalThrough` で指標ごとに指定できる。

既存の 11月27日 QA 除外を適用し、senior-cat の識別用 QA クエリも既存のフィルターで除外する。Workflow は Day 0 を null に固定し、Google の結果を #58 の集計器で検証して一時ディレクトリを削除する。楽天成果は引き続き既存の公式 CSV 検証経路を使用し、未取得・未帰属の成果は UNKNOWN とする。従来の JSON 鍵による検索試験 CLI は従来どおり使用できる。

- [Google Cloud の GitHub Actions 向け WIF 設定](https://docs.cloud.google.com/iam/docs/workload-identity-federation-with-deployment-pipelines)
- [Google の GitHub 認証アクション](https://github.com/google-github-actions/auth)
