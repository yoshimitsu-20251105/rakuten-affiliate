# Tooling Registry

外部ツール・API・サービスの接続状況を一元管理する。未接続は `NOT_CONNECTED`。料金は確認できたものだけ記載し、推測の金額は入れない(不明な場合は `UNKNOWN`)。

各ツールは以下の項目で記録する: Tool / 日本語での用途 / Category / Purpose / Data Provided / Read or Write / Cost / Status / Limitations / When To Use / Replacement Candidate / Last Reviewed

---

### Claude Code
- 日本語での用途: 調査・実装・レビューを行うAIエージェント(本ツール自体)
- Category: AI Agent / Implementation
- Purpose: Implementation Brief に基づく実装、PR作成、テスト実行
- Data Provided: コード変更・テスト結果・調査結果
- Read or Write: Read/Write(リポジトリに対して)
- Cost: ユーザー契約のサブスクリプション(金額はUNKNOWN、本リポジトリからは確認できない)
- Status: CONNECTED
- Limitations: 戦略判断を独断で行わない(CLAUDE.md参照)。master直接pushは行わない
- When To Use: 承認済みのImplementation Briefがある場合の実装・PR作成
- Replacement Candidate: UNKNOWN
- Last Reviewed: 2026-10-05

### GitHub
- 日本語での用途: ソースコード・Issue・PRの管理
- Category: Infrastructure
- Purpose: ブランチ・PR経由での変更管理、人間承認の記録
- Data Provided: コミット履歴・PR状態・Issue
- Read or Write: Read/Write
- Cost: 公開リポジトリのため無料(FACT、CLAUDE.md記載)
- Status: CONNECTED
- Limitations: なし(現状の運用範囲内)
- When To Use: 常時(全ての変更管理の基盤)
- Replacement Candidate: UNKNOWN
- Last Reviewed: 2026-10-05

### GitHub Actions
- 日本語での用途: 日次パイプラインの自動実行
- Category: Infrastructure / Automation
- Purpose: `select-products.js` → `generate-site.js` → push を毎日自動実行
- Data Provided: 実行ログ、コミット履歴
- Read or Write: Write(docs/・articles-data.json等への自動コミット)
- Cost: 公開リポジトリのため無料・無制限(FACT、CLAUDE.md記載)
- Status: CONNECTED
- Limitations: Secrets管理が必要(RAKUTEN_APP_ID等)。ワークフロー自体は今回のタスクで変更禁止対象
- When To Use: 日次の商品選定・サイト更新(既存運用のまま)
- Replacement Candidate: UNKNOWN
- Last Reviewed: 2026-10-05

### Google Search Console
- 日本語での用途: 検索表示回数・クリック数・掲載順位・インデックス状況の確認
- Category: Analytics
- Purpose: Organic Searchのファネル上流(impressions/clicks)を計測
- Data Provided: impressions, clicks, average position, URL Inspection状態
- Read or Write: Read(読み取り専用。安全ゲート必須、keyword-research/search-trial-live-gate.js参照)
- Cost: 無料(Googleの公式ツール)
- Status: CONNECTED(連携済み、FACT。CLAUDE.md「運用状況」記載)
- Limitations: `--live`フラグ+環境変数2つが揃わないと実行できない(事故防止のfail-closed設計)。低頻度クエリは匿名化され見えないことがある
- When To Use: 検索流入実験のreviewDateでの観測(`keyword-research/cli/search-trial-report.js`)
- Replacement Candidate: Bing Webmaster Tools(Google以外の検索エンジン向け、代替にはならず補完)
- Last Reviewed: 2026-10-05

### GA4
- 日本語での用途: ページ閲覧・CTAクリック(affiliate_click)の計測
- Category: Analytics
- Purpose: Organic Searchのファネル下流(セッション・ページビュー・affiliate_click)を計測
- Data Provided: sessions, screenPageViews, affiliate_clickイベント数
- Read or Write: Read(読み取り専用、同じ安全ゲート経由)
- Cost: 無料(Googleの公式ツール)
- Status: CONNECTED(連携済み、FACT)
- Limitations: Google Search Consoleと同じライブ実行ゲートが必要
- When To Use: 検索流入実験のreviewDateでの観測
- Replacement Candidate: UNKNOWN
- Last Reviewed: 2026-10-05

### Google Keyword Planner
- 日本語での用途: キーワードの月間検索数・競合度の調査
- Category: Research
- Purpose: 新規テーマ候補の需要規模を確認する
- Data Provided: monthlySearches, competitionLevel/Index, trendIndex
- Read or Write: Read(ただしAPI直接連携ではなく、手動エクスポートしたCSVを `keywords:import-gkp` で取込む運用)
- Cost: Google広告アカウントに付随(個別の追加費用はUNKNOWN)
- Status: CONNECTED(実データでの取込実績あり、FACT)
- Limitations: competitionIndexは広告入札競合の指標であり、自然検索SERP競合とは別物(混同しないこと)
- When To Use: 新規検索流入テーマの需要調査
- Replacement Candidate: Ahrefs(現状NOT_CONNECTEDのため比較不可)
- Last Reviewed: 2026-10-05

### Rakuten API(IchibaItem/Search等)
- 日本語での用途: 楽天市場の商品データ取得・アフィリエイトリンク生成
- Category: Monetization / Data Source
- Purpose: 商品選定・在庫確認・価格/レビュー取得
- Data Provided: itemName, itemPrice, reviewCount, reviewAverage, affiliateUrl等
- Read or Write: Read(商品検索のみ。書き込みAPIは使用していない)
- Cost: 無料(楽天アフィリエイトプログラム参加のみで利用可能)
- Status: CONNECTED(本プロジェクトの収益化の中核、FACT)
- Limitations: 1秒1回のレート制限。APIバージョンが度々変わる(CLAUDE.md「既知の落とし穴」参照)
- When To Use: 日次商品選定、公開ページの商品補完(enrich-publication-products.js等)
- Replacement Candidate: Amazon Associates / PA-API(NOT_CONNECTED)
- Last Reviewed: 2026-10-05

### ChatGPT
- 日本語での用途: UNKNOWN(本プロジェクトでの利用実績は本セッションからは確認できない)
- Category: AI Agent
- Purpose: UNKNOWN
- Data Provided: UNKNOWN
- Read or Write: UNKNOWN
- Cost: UNKNOWN
- Status: NOT_CONNECTED
- Limitations: UNKNOWN
- When To Use: UNKNOWN
- Replacement Candidate: UNKNOWN
- Last Reviewed: 2026-10-05

### ChatGPT Work
- 日本語での用途: UNKNOWN
- Category: AI Agent
- Purpose: UNKNOWN
- Data Provided: UNKNOWN
- Read or Write: UNKNOWN
- Cost: UNKNOWN
- Status: NOT_CONNECTED
- Limitations: UNKNOWN
- When To Use: UNKNOWN
- Replacement Candidate: UNKNOWN
- Last Reviewed: 2026-10-05

### GSC Wizard
- 日本語での用途: UNKNOWN(Search Console分析補助ツールと推測されるが未確認)
- Category: Analytics
- Purpose: UNKNOWN
- Data Provided: UNKNOWN
- Read or Write: UNKNOWN
- Cost: UNKNOWN
- Status: NOT_CONNECTED
- Limitations: UNKNOWN
- When To Use: UNKNOWN
- Replacement Candidate: Google Search Console(既存運用で直接利用中のため優先度低)
- Last Reviewed: 2026-10-05

### Ahrefs
- 日本語での用途: SEO競合分析・被リンク調査ツール
- Category: Research
- Purpose: UNKNOWN(本プロジェクトでの利用実績なし)
- Data Provided: UNKNOWN
- Read or Write: UNKNOWN
- Cost: UNKNOWN(有料ツールであることは一般に知られるが、本プロジェクトとしての契約有無・金額はUNKNOWN)
- Status: NOT_CONNECTED
- Limitations: UNKNOWN
- When To Use: UNKNOWN
- Replacement Candidate: Google Keyword Planner(需要調査の一部は代替中)
- Last Reviewed: 2026-10-05

### Amazon Associates / PA-API
- 日本語での用途: Amazon商品のアフィリエイト・商品データ取得
- Category: Monetization / Data Source
- Purpose: UNKNOWN(本プロジェクトでの利用実績なし)
- Data Provided: UNKNOWN
- Read or Write: UNKNOWN
- Cost: UNKNOWN
- Status: NOT_CONNECTED
- Limitations: UNKNOWN
- When To Use: UNKNOWN
- Replacement Candidate: Rakuten API(現行の主要データソース)
- Last Reviewed: 2026-10-05

### A8.net
- 日本語での用途: ASP(アフィリエイトサービスプロバイダー)
- Category: Monetization
- Purpose: UNKNOWN
- Data Provided: UNKNOWN
- Read or Write: UNKNOWN
- Cost: UNKNOWN
- Status: NOT_CONNECTED
- Limitations: UNKNOWN
- When To Use: UNKNOWN
- Replacement Candidate: UNKNOWN
- Last Reviewed: 2026-10-05

### ValueCommerce
- 日本語での用途: ASP
- Category: Monetization
- Purpose: UNKNOWN
- Data Provided: UNKNOWN
- Read or Write: UNKNOWN
- Cost: UNKNOWN
- Status: NOT_CONNECTED
- Limitations: UNKNOWN
- When To Use: UNKNOWN
- Replacement Candidate: UNKNOWN
- Last Reviewed: 2026-10-05

### もしもアフィリエイト
- 日本語での用途: ASP
- Category: Monetization
- Purpose: UNKNOWN
- Data Provided: UNKNOWN
- Read or Write: UNKNOWN
- Cost: UNKNOWN
- Status: NOT_CONNECTED
- Limitations: UNKNOWN
- When To Use: UNKNOWN
- Replacement Candidate: UNKNOWN
- Last Reviewed: 2026-10-05

### Bing Webmaster Tools
- 日本語での用途: Bing検索のインデックス状況確認
- Category: Analytics
- Purpose: UNKNOWN(本プロジェクトでの利用実績なし)
- Data Provided: UNKNOWN
- Read or Write: UNKNOWN
- Cost: 無料(一般的に無料のツールとして知られるが、本プロジェクトでの契約状況はUNKNOWN)
- Status: NOT_CONNECTED
- Limitations: UNKNOWN
- When To Use: UNKNOWN
- Replacement Candidate: UNKNOWN
- Last Reviewed: 2026-10-05

### IndexNow
- 日本語での用途: 更新通知プロトコル(Bing等対応検索エンジン向け)。GLOSSARY.md参照
- Category: SEO / Infrastructure
- Purpose: UNKNOWN(本プロジェクトでの利用実績なし)
- Data Provided: N/A
- Read or Write: Write(更新をプッシュ通知するのみ)
- Cost: 無料
- Status: NOT_CONNECTED
- Limitations: Googleのインデックス登録を直接促進するものではない(GLOSSARY.md参照)
- When To Use: sitemap取得失敗問題への補助的な対策を検討する場合(ただしGoogle対策としての効果は限定的)
- Replacement Candidate: UNKNOWN
- Last Reviewed: 2026-10-05

### note
- 日本語での用途: 記事投稿プラットフォーム
- Category: Editorial / Distribution
- Purpose: UNKNOWN(本プロジェクト=rakuten-affiliateでの利用実績なし。別リポジトリnote-articlesで利用の可能性があるが本リポジトリからは確認できない)
- Data Provided: UNKNOWN
- Read or Write: UNKNOWN
- Cost: UNKNOWN
- Status: NOT_CONNECTED(本リポジトリの範囲では)
- Limitations: UNKNOWN
- When To Use: UNKNOWN
- Replacement Candidate: UNKNOWN
- Last Reviewed: 2026-10-05

### YouTube
- 日本語での用途: 動画投稿プラットフォーム(YouTube Shorts等)
- Category: Editorial / Distribution
- Purpose: UNKNOWN
- Data Provided: UNKNOWN
- Read or Write: UNKNOWN
- Cost: UNKNOWN
- Status: NOT_CONNECTED
- Limitations: UNKNOWN
- When To Use: UNKNOWN
- Replacement Candidate: UNKNOWN
- Last Reviewed: 2026-10-05

### TikTok
- 日本語での用途: 動画投稿プラットフォーム
- Category: Editorial / Distribution
- Purpose: UNKNOWN
- Data Provided: UNKNOWN
- Read or Write: UNKNOWN
- Cost: UNKNOWN
- Status: NOT_CONNECTED
- Limitations: UNKNOWN
- When To Use: UNKNOWN
- Replacement Candidate: UNKNOWN
- Last Reviewed: 2026-10-05

### Playwright
- 日本語での用途: ブラウザ自動操作・E2Eテストツール
- Category: Tooling / QA
- Purpose: UNKNOWN(本プロジェクトでの利用実績なし。テストはnode:testで実装)
- Data Provided: N/A
- Read or Write: N/A
- Cost: 無料(OSS)
- Status: NOT_CONNECTED
- Limitations: UNKNOWN
- When To Use: 将来、公開ページのブラウザ上での自動確認(モバイル表示等)が必要になった場合
- Replacement Candidate: 現状は手動のブラウザ確認(本セッションの検証workflow)で代替
- Last Reviewed: 2026-10-05

### Lighthouse
- 日本語での用途: ページ品質(パフォーマンス・SEO・アクセシビリティ)の自動測定ツール
- Category: Tooling / QA
- Purpose: UNKNOWN(本プロジェクトでの利用実績なし)
- Data Provided: UNKNOWN
- Read or Write: N/A
- Cost: 無料(Google製、OSS)
- Status: NOT_CONNECTED
- Limitations: UNKNOWN
- When To Use: UNKNOWN
- Replacement Candidate: UNKNOWN
- Last Reviewed: 2026-10-05
