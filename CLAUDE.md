# rakuten-affiliate

楽天市場の商品を毎日自動選定し、静的サイト(GitHub Pages)として公開する楽天アフィリエイトサイト。

- 公開サイト: https://yoshimitsu-20251105.github.io/rakuten-affiliate/
- リポジトリ: https://github.com/yoshimitsu-20251105/rakuten-affiliate
- GitHubアカウント: yoshimitsu-20251105

## 全体アーキテクチャ

1. `select-products.js` — 楽天APIから商品を検索・選定し `selected-products.json` に保存
2. `generate-site.js` — `selected-products.json` の新着分を `articles-data.json`(全商品の蓄積)に追加し、`docs/` 以下に静的HTMLサイトを生成
3. `generate-social-posts.js` — ランキンググループからSNS投稿文の下書きを `social-posts.txt` に生成(自動投稿はしない、手動コピペ用)
4. **`.github/workflows/daily-pipeline.yml`(2026-08-19導入、本番の自動実行経路)** — 上記1〜3を実行し、`git commit` → `git push` → 結果をメール通知(`dawidd6/action-send-mail`)まで行う。**GitHub Actions上で毎日22:07 UTC(7:07 JST)に実行**され、ローカルPCの起動状態(電源・スリープ・外出)と一切関係なく動く。リポジトリSecrets(`RAKUTEN_APP_ID`/`RAKUTEN_SECRET`/`RAKUTEN_AFFILIATE_ID`/`GMAIL_ADDRESS`/`GMAIL_APP_PASSWORD`)を使用。公開リポジトリのためGitHub Actionsの実行時間は無料・無制限。手動実行は `gh workflow run daily-pipeline.yml`
5. `run-pipeline.ps1` + Windowsタスクスケジューラ(`RakutenAffiliatePipeline`, 毎朝7:00 JST) — **旧経路。GitHub Actions移行の動作確認が取れ次第、停止予定**。それまでは並行稼働(新商品がなければ「変更なし」で終わるだけなので二重実行の実害はない)
6. クラウド定期タスク(claude.ai routine「楽天トレンドセレクト 毎日調査・改善」)は**2026-08-19付けで無効化(停止)済み**。理由: claude.aiのGitHub連携が書き込み権限を一切付与できない既知の未解決バグ(Anthropic公式issue [anthropics/claude-ai-mcp#822](https://github.com/anthropics/claude-ai-mcp/issues/822))があり、このルーティンが生成した改善は常にpush失敗で失われ続けていた。削除はしていないため再開は可能だが、再開するならGitHub Actions経由でのAI実行(`anthropics/claude-code-action`、要`ANTHROPIC_API_KEY`のリポジトリSecret、従量課金あり)に置き換える方が確実

## 商品選定ロジック(select-products.js)

- 季節枠(高利益枠): 実行月に応じて自動切替(9-12月ふるさと納税/6-8月水飲料/1-5月通年ジャンル強化)
- 安定枠(エバーグリーン): サプリ・美容サブスク等、通年
- 発見枠: 楽天総合リアルタイムランキングから、ジャンルを問わず品質フィルタ通過分を発掘
- スコアリング: レビュー評価55点+レビュー件数30点+リピート性15点=100点満点(ランキング比較ページで使用)

## 絶対に守るルール

- **捏造禁止**: 存在しない「期間限定」「数量限定」等の緊急性を作らない。著名人の使用実績も実データに記載がない限り書かない。レビューや実績を誇張しない
- **実データ最優先**: 商品名・catchcopy・itemCaption・reviewCount・reviewAverageなど、楽天APIの実データのみを根拠にする
- 大規模な作り直しより、着実な改善の積み重ねを優先する
- 半自動(以前) → 完全自動push(現在、ユーザー承認済み)。ただし何か大きな設計変更をする際は確認を取る

## 既知の落とし穴(ハマりやすい点)

- **楽天検索APIのバージョンは度々変わる**。`IchibaItem/Search` は `20260701` を使用中(2026年8月時点)。`wrong_parameter: API Configuration not found` が出たら、まず https://webservice.rakuten.co.jp/documentation/ichiba-item-search で最新バージョンを確認すること。ランキングAPI(`IchibaItem/Ranking`)は `20220601` のままで別物
- **文字化け**: タスクスケジューラ(無コンソール環境)ではPowerShellのオブジェクトパイプ(`*>>`, `2>&1 | ...`)経由の出力が文字化けする。node/gitの出力は `cmd /c "... >> logfile 2>&1"` の生バイトリダイレクトを使うこと(`run-pipeline.ps1`参照)
- **APIレート制限**: 楽天APIは1秒1回まで。`select-products.js`は`sleep(1200)`でリクエスト間隔を空けている
- **URLスラッグの長音記号**: 日本語スラッグ生成の正規表現には `ー`(長音記号)を含めること。含めないと「コーヒー」等が壊れる
- **`.env`は絶対にコミットしない**(`.gitignore`済み)。`RAKUTEN_APP_ID`, `RAKUTEN_SECRET`, `RAKUTEN_AFFILIATE_ID`, `GMAIL_APP_PASSWORD`, `GA_MEASUREMENT_ID` を含む

## 判断の境界線(専門家確認が必要な領域)

このプロジェクトはAIエージェントが自律的に改善を続ける前提のため、以下は**AIの調査結果だけで断定せず、専門家への確認を促すこと**:
- 法律(景品表示法・特定商取引法・著作権等)に関わる判断
- 税金・確定申告など、収益発生後の税務処理
- 収益予測の数字(常に「これは目安であり保証ではない」旨を明示する)

`research-log.md` にクラウド定期タスクの調査知見を蓄積し、同じ調査の繰り返しを避け、市場分析の精度を積み上げていく。

## 調査手法: 「検証→反証→出典」を必ず行う(データを鵜呑みにしない)

新しい知見を見つけて実装に反映する前に、以下のプロセスを必ず踏むこと:

1. **調査**: 主張・トレンド・数字を見つける(WebSearch/WebFetch)
2. **反証を探す**: その主張に対する反対意見・懐疑的な見方・失敗事例を意図的に検索する(例:「〇〇 効果ない」「〇〇 デメリット」「〇〇 逆効果」で再検索)。特に「稼げる」「バズる」を謳う記事は、書き手自身がその手法を売っている自己言及的なポジショントークである場合が多いため要注意
3. **突き合わせ**: 支持する情報と反対する情報の両方を比較し、どちらが実データ(このサイトの実測値、複数の独立した情報源)に近いかで判断する。意見が割れている場合は、両論併記した上で「今回はこちらを採用する。理由は〜」と明記する
4. **出典を明記**: 実装した変更のコミットメッセージ・`research-log.md`には、参考にした情報源(URL)を必ず残す。反証側の情報源も残す

`research-log.md`の各エントリは、可能な限り「支持する根拠」と「反対・懐疑的な見方」の両方を記載する形式にする。

## 運用状況(2026年8月時点)

- 楽天ウェブサービス: APIバックエンド型で登録済み(IPアドレス制限方式)
- 楽天アフィリエイト: 登録・サイト登録済み
- 楽天銀行口座: 申込完了、承認待ち
- Google Search Console / GA4: 連携済み
- 収益: まだ発生していない(公開直後のため、インデックス反映待ち)
