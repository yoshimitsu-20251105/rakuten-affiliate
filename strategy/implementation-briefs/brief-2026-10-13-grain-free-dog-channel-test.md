# Implementation Brief

## ID

brief-2026-10-13-grain-free-dog-channel-test(実験ID: `exp-2026-10-13-grain-free-dog-channel-note-vs-x`)

## Objective

同一LP・同一商品・同一CTAを固定し、**流入チャネル(note vs X)だけを変えた**場合に、どちらが先にsessions / affiliate_click / conversion / Revenueを生むかを検証する。Googleの索引待ち(別レーンで追跡)に依存せず、最短で「LPから楽天への送客と初売上が発生しうるか」を確認する。

対象LP: https://yoshimitsu-20251105.github.io/rakuten-affiliate/rankings/grain-free-dog-food.html

## Business KPI

優先順位(CLAUDE.mdの売上直結KPIに準拠): 1. Revenue 2. Conversions 3. EPC(Revenue ÷ affiliate_click) 4. affiliate_click 5. Affiliate CTR(affiliate_click ÷ screenPageViews) 6. sessions。投稿数・記事数は成功指標にしない。

## Hypothesis

- H1: noteは説明型コンテンツから比較LPへ送客するため、XよりAffiliate CTRが高くなる可能性がある
- H2: Xは短期間で露出を得られる可能性があるが、購入意図が弱くAffiliate CTRが低い可能性がある

(いずれもHYPOTHESIS。現時点で裏付けデータなし)

## Evidence

- FACT: 対象LPは本番公開済み(HTTP 200、noindexなし、self canonical、GA4・affiliate_clickあり。2026-10-05確認)
- FACT: LPファイルは2026-10-05のコミット`4e2bb55`以降変更されていない(blob hash `6145171f3b536dcd9e83f85a99f20aea3ea614fb`、2026-10-13時点)。固定変数の起点として記録する
- FACT: LPは2026-10-10時点でURL Inspection=URL is unknown to Google(lastCrawlTimeなし)。現時点で検索流入は発生していないため、チャネル流入が唯一の外部流入になる見込み
- FACT: 2026-10-10時点のGA4流入元は、LPはDirectのみ(1 session)、既存2ページもDirect中心で、ReferralとOrganic Socialは0(`byTrafficSource`)。UTM付きnote/X流入はこの2チャネルグループで分離できる見込み
- ESTIMATE(要初回検証): GA4の既定チャネルグループ定義では、`utm_medium=referral`→Referral、`utm_medium=social`→Organic Socialに分類される。最初のUTM付きアクセスで実際の分類を確認するまでESTIMATEとして扱う

## Counter Evidence

- CH1: note自体に十分な流入がなく、送客チャネルとして成立しない可能性
- CH2: Xもアカウント側の配信力が弱ければ十分なsessionsを作れない可能性
- CH3: note/Xの双方からsessionsが発生してもaffiliate_clickが発生しない場合、問題はチャネルではなくLP・商品・CTA側にある可能性
- UNKNOWN: note・Xのアカウントの有無、フォロワー数、過去の反応。CH1/CH2の可能性を事前に評価できない
- 構造上の限界: 「チャネル」にはプラットフォームだけでなく投稿形式(note=長文/X=短文)とアカウントの読者層が含まれる。本実験が比較するのは「チャネル一式」であり、プラットフォーム単体の優劣ではない
- 構造上の限界(検出力): 流入が少数になる見込みで、Affiliate CTRの差は統計的に判断できない可能性が高い。本実験で信頼できる結論は「各チャネルが一定のsessions/clickを作れたか」までで、CTRの優劣は参考値に留まる(ESTIMATE)
- 別実験への影響: note/Xからの外部リンクは、LPのGoogle発見(discovery)を助ける可能性がある。以後、`exp-2026-10-05-grain-free-dog-food`(SEO実験)の「未インデックス」解釈には、チャネル投稿日を併記して読むこと

## Scope

- 本Briefの範囲は、(1)本Briefの作成、(2)`strategy/experiments.json`への新規実験のPLANNED登録、(3)`strategy/CURRENT_STATE.md`の反映のみ
- note・Xへの投稿本文の作成および投稿は本Briefの範囲外。**自動投稿は行わない**。投稿は人が実施する(投稿本文の作成を依頼する場合は別途指示を受ける)
- 実投稿が公開されるまで`status`をRUNNINGに変更しない

## Files Allowed To Change

- `strategy/implementation-briefs/brief-2026-10-13-grain-free-dog-channel-test.md`(新規)
- `strategy/experiments.json`(新規実験1件の追加、PLANNED)
- `strategy/CURRENT_STATE.md`(Active ExperimentsのPLANNED欄・Top Prioritiesの該当行・Last Updated)

## Files Not Allowed To Change

- `docs/`配下(全件。LP本文・title・meta description・商品・表示順・CTA・affiliate URLを含む)
- `keyword-research/`配下のコード(計測用コードの変更を含む。今回は変更不要)
- `keyword-research/search-trial-pages.json`、`generate-site.js`、`select-products.js`、`.github/workflows/`
- `CLAUDE.md`

## Implementation Requirements

### 固定変数(今回変更しない)

LP本文 / title / meta description / 商品 / 表示順 / CTA / affiliate URL。実験期間中にLPの変更が必要になった場合(例: 掲載商品の販売終了)は、プロトコル逸脱として記録し、その時点以降のデータを別扱いにする。確認方法: `git log <startDate>..HEAD -- docs/rankings/grain-free-dog-food.html`が空であること。

### 変更変数

流入チャネルのみ(A=note / B=X)。

### UTM

| チャネル | URL |
|---|---|
| A: note | `https://yoshimitsu-20251105.github.io/rakuten-affiliate/rankings/grain-free-dog-food.html?utm_source=note&utm_medium=referral&utm_campaign=grain_free_dog_test_01` |
| B: X | `https://yoshimitsu-20251105.github.io/rakuten-affiliate/rankings/grain-free-dog-food.html?utm_source=x&utm_medium=social&utm_campaign=grain_free_dog_test_01` |

投稿ごとの差分を区別する必要がある場合のみ`utm_content=`を付与する(1チャネル1投稿なら不要)。canonicalはクエリなしのself URLのままで、UTM付きURLによる重複の問題は生じない(FACT: canonical属性はクエリを含まない固定値)。

### 投稿を公開する前の条件(人が確認)

- 投稿に「PR」または広告を含む旨の表記を入れる(アフィリエイトLPへ誘導するため)
- 犬の健康効果・医療効果の断定表現を使わない(LPと同じ基準)
- note・Xそれぞれの利用規約・アフィリエイト関連ルールに反しないことを確認する(現時点UNKNOWN。本Briefでは確認していない)
- 初回UTMリンクを自分で1回開いてGA4に記録されるかを確認する場合、そのアクセスはQA sessionとして日時を記録し、集計時に注記する
- 公開直前にLPが200を返し、掲載4商品の販売ページが開けることを確認する

## Measurement Plan

- 開始日: note・Xの両投稿が公開された日(同日公開を推奨)をstartDateとする。観測期間は14日、reviewDate = startDate + 14日(PLANNEDの間はnull、RUNNING遷移時に確定)
- 取得: 既存の`keyword-research/cli/search-trial-report.js`(`--live`ゲート付き)の`ga4.byTrafficSource` / `ga4.affiliateClickByTrafficSource`。note=Referral、X=Organic Social(上記ESTIMATEの初回検証後に確定)。観測日は公開後3日・7日・14日
- 現状の限界: 現行の内訳はチャネルグループ単位で、`utm_campaign`単位ではない。2026-10-10時点でLPのReferral/Organic Socialは0のため、当面はチャネルグループで分離できる。他のReferral/Organic Social流入が現れた場合は、GA4のsessionSource・sessionCampaignNameで絞り込む(必要になった時点で判断。現時点では未実装)
- Revenue / Conversions: 楽天アフィリエイト管理画面で**人が**確認する(リポジトリ側は`NOT_CONNECTED`)。affiliate URLが固定のため、楽天側の成果を**チャネル別に分離できない**(UNKNOWN)。チャネル別の成果の帰属は、affiliate_clickの流入元別内訳による按分(ESTIMATE)に留まる。チャネル別に追跡する場合はaffiliate URLの変更が必要となり、固定変数に反するため今回は行わない
- 承認済み報酬(Approved Revenue)は確定まで時間がかかるため、14日時点のRevenueは未確定報酬(ESTIMATE)として扱う
- データ未反映は0と断定せず、NOT_AVAILABLE/未反映として扱う

## Success Criteria

(以下の数値は本Briefでの提案値。ESTIMATE。承認前に調整可能)

- 実験SUCCESS: 観測期間内に楽天の成果(conversion)が1件以上発生し、Revenue > 0が確認される
- チャネル成立: あるチャネルが観測期間内にsessions 20以上、かつaffiliate_click 1以上を作る
- H1/H2の判定に使える条件: 両チャネルとも、affiliate_clickが5件以上ある場合のみAffiliate CTRを比較して判断する。満たさない場合はH1/H2ともINCONCLUSIVE(反証でも支持でもない)

## Kill Criteria

- 観測期間終了時に、両チャネルともsessionsが20未満 → CH1/CH2が有力。チャネル比較としては成立せず終了(LPの優劣は結論しない)
- 実験期間中にLPが変更された場合 → その時点で実験を無効とする

## Rollback Plan

LP・コード・affiliate URLを変更しないため、ロールバック対象はない。実験を止める場合は`experiments.json`の`status`を更新し、投稿の削除・非公開は人が判断する(自動削除はしない)。

## 判定の手順

| 観測 | 判断 |
|---|---|
| 露出はあるがサイト訪問がない | 投稿の訴求またはチャネルの問題 |
| サイト訪問はあるがaffiliate_clickがない | LP / CTA / 商品選定の問題候補(CH3) |
| affiliate_clickはあるがconversionがない | 商品・価格・販売先・購入意図の問題候補 |
| conversionはあるがRevenue/EPCが低い | 楽天以外のASP・Amazon・公式案件の比較へ進む |

「露出」はnote・Xの閲覧数であり、リポジトリでは取得できない(UNKNOWN)。投稿側の閲覧数は人が各プラットフォームの画面で確認して記録する。

## Required Tests

- `npm run strategy:validate`
- `npm test`(既存テストを壊さないこと。新規テストの追加は不要)
- `docs/`配下の差分が0件であること

## Required Report

experiment ID / Implementation Brief / hypothesis / counter hypothesis / UTM / fixed variables / changed variable / KPI / success condition / falsification condition / measurement plan / additional setupの要否 / changed files / tests / PR番号
