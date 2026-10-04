# strategy/ — AI Agent Operating System

このディレクトリは、楽天アフィリエイト自動化プロジェクトを「Research / Strategy」「Editorial」「Analytics」「Implementation」の4つのAIエージェント層で運用するための管理基盤である。目的は記事数・コード量・自動化率を増やすことではなく、**的外れな開発や同じ失敗の繰り返しを防ぎ、成功した収益化施策だけを記録・再現・拡大できる仕組みを作ること**。恒久的な運用ルールは リポジトリルートの [`CLAUDE.md`](../CLAUDE.md) を参照。

## 4つのAgentの役割

| Agent | 役割 |
|---|---|
| **Revenue Strategy / Research Agent** | 市場調査・検索需要・SERP・ASP・報酬・競合・季節性・収益機会・反証を担当する |
| **Editorial Agent** | 承認されたテーマを SEO記事 / note / X / TikTok / YouTube Shorts 等へ変換する |
| **Analytics / Experiment Agent** | Search Console・GA4・affiliate click・conversion・revenueを分析し、SCALE/IMPROVE/HOLD/KILLを判断する |
| **Claude Code(Implementation Agent)** | 上記で決定された内容を実装する。戦略を独断で決めない |

## 「今どうなっているか」をすぐ把握するには

- [`CURRENT_STATE.md`](CURRENT_STATE.md) — プロジェクト全体の現在地を1ファイルで把握する(履歴は書かない)
- [`daily-reports/`](daily-reports/) — 日次の作業記録(事実中心、`YYYY-MM-DD.md`)
- [`GLOSSARY.md`](GLOSSARY.md) — 専門用語集(非エンジニア向け)

新しい調査・実装を始める前に、必ず `CURRENT_STATE.md`・`decisions.json`・`experiments.json`・`daily-reports/`・`opportunities.json` を確認し、同じ調査・実装の繰り返しを避けること(CLAUDE.mdの「重複作業防止ルール」参照)。

## 運用フロー

```
Daily Research
  ↓ (strategy/templates/daily-intelligence.md)
Weekly Strategy Review
  ↓ (strategy/templates/weekly-strategy-review.md)
Implementation Brief
  ↓ (strategy/templates/implementation-brief.md)
Claude Code
  ↓
PR
  ↓
Human Approval
  ↓
Production
  ↓
Analytics
  ↓ (strategy/templates/experiment-review.md)
Experiment Review
  ↓
Scale / Improve / Hold / Kill
```

### Daily(Research Agent)

`strategy/templates/daily-intelligence.md` を使って日次の調査結果を記録する。**毎日必ず何かを変更する必要はない。** 重要な変化がなければ `NO MATERIAL CHANGE` とだけ記録する。新しい収益機会は `opportunities.json`、報酬・ASPの変化は `monetization-sources.json`、SERP/競合の変化は `competitors.json` への追記候補として扱う。

### Weekly(Strategy Agent)

`strategy/templates/weekly-strategy-review.md` を使って週次でKPIと実験状況をレビューし、`opportunities.json` の各案件を SCALE/TEST/HOLD/KILL に分類する。**次週の優先施策は最大3つまで**とし、やることを増やしすぎない。

### Implementation Brief → Claude Code

戦略的な変更(新規ページの大量作成、収益化ロジックの変更、キーワード方針の大幅な転換等)は、`strategy/templates/implementation-brief.md` を使った正式な引き継ぎ書を経由する。**Implementation Briefがない戦略的変更は、Claude Codeが独断で実装しない**(CLAUDE.md参照)。

### Experiment Review(Analytics Agent)

実装がPRを経て本番に反映された後、`strategy/templates/experiment-review.md` を使って `experiments.json` の該当エントリを観測結果で更新し、SCALE/IMPROVE/HOLD/KILLを判断する。**失敗した実験も削除しない。** 同じ失敗を再提案しないための知識資産として `learnings` に残す。

### Editorial Agent

承認された `opportunities.json` のテーマは、`strategy/templates/content-brief.md` を経由してEditorial Agentへ引き継がれ、SEO記事やSNS向けコンテンツへ変換される。

## データファイル

| ファイル | 役割 | スキーマ |
|---|---|---|
| [`opportunities.json`](opportunities.json) | 市場・テーマ・キーワード単位の収益機会(trafficScore/moneyScore等のスコアリング、hypothesis/counterEvidence/unknowns) | [`schemas/opportunities.schema.json`](schemas/opportunities.schema.json) |
| [`experiments.json`](experiments.json) | 収益化実験の履歴(仮説・反証条件・baseline・成功/停止しきい値・結果・学び)。失敗した実験も削除しない | [`schemas/experiments.schema.json`](schemas/experiments.schema.json) |
| [`decisions.json`](decisions.json) | 重要判断の履歴(事実・前提・選択肢・結論のみ。詳細なchain-of-thoughtは書かない) | [`schemas/decisions.schema.json`](schemas/decisions.schema.json) |
| [`seasonality.json`](seasonality.json) | 季節型Revenue Engineの管理(ピーク月・リードタイム・規制/在庫リスク)。数値は捏造せず未確認値はnull | [`schemas/seasonality.schema.json`](schemas/seasonality.schema.json) |
| [`monetization-sources.json`](monetization-sources.json) | 広告・ASP・ECの統一管理(報酬体系・EPC・承認率・Cookie window)。未取得値はnull | [`schemas/monetization-sources.schema.json`](schemas/monetization-sources.schema.json) |
| [`competitors.json`](competitors.json) | 競合調査結果(SERP順位・強み弱み・独自価値・収益化手法)。SERP順位は時間で変わるため `observedAt` 必須 | [`schemas/competitors.schema.json`](schemas/competitors.schema.json) |

各ファイルは `{ "description": "...", "items": [...] }` の形式。`items` の各要素が対応するスキーマを満たす必要がある。

## 事実区分

どのファイル・テンプレートに書く内容も、以下のいずれかを明示する(詳細はCLAUDE.md参照)。

- `FACT` — 実データ・実測値で裏付けられている
- `ESTIMATE` — 推定値(根拠・前提を明記する)
- `HYPOTHESIS` — まだ検証していない仮説
- `UNKNOWN` — 未確認・不明(nullのまま残す。推測で埋めない)

## Revenue Engine

`opportunities.json` の `revenueEngines` で使う分類:

`VOLUME` / `MARGIN` / `RECURRING` / `SUBSCRIPTION` / `SEASONAL` / `TREND` / `LEAD` / `B2B`

## KPI

目的は記事数・ページ数・コード量・自動化率ではない。目的は以下を持続的に増加させることである(CLAUDE.md参照):

Revenue / Approved Revenue / Profit / EPC / Conversion Rate / Affiliate CTR / Organic Traffic

## Validation

```bash
npm run strategy:validate
```

`strategy/cli/validate.js` が全データファイルを対応スキーマに対して検証する(JSON構文・必須項目・型・enum・日付形式・ID重複・`decisions.json`→`experiments.json`の相互参照)。外部ライブラリ・外部APIは使わない。テストは `strategy/test/validate.test.js`(`npm test` に統合済み)。

## 今後の接続ステップ

このPRで作るのは管理基盤(ファイル・スキーマ・テンプレート・validation CLI)のみ。各Agentを実際に接続するのは別のImplementation Briefを経て段階的に行う想定:

1. **Daily Intelligence Agent** — 日次でWeb調査を行い `daily-intelligence.md` を生成し、`opportunities.json`/`competitors.json`/`monetization-sources.json` への追記候補を提示する
2. **Weekly Strategy Agent** — `experiments.json`/`opportunities.json` を集計し `weekly-strategy-review.md` を生成、Implementation Brief候補を作る
3. **Editorial Agent** — 承認済みテーマを `content-brief.md` 経由でコンテンツ化する
4. **Analytics Agent** — 既存の `keyword-research/cli/search-trial-report.js`(Search Console/GA4の安全ゲート付きCLI)の出力を `experiments.json` の `metrics` へ反映し、`experiment-review.md` を生成する

いずれも、今回作成した `strategy:validate` を通過するデータのみを正式な記録として扱う。
