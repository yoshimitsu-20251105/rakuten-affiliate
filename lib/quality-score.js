// 既存Quality Scoreの実装(元は generate-site.js に直接定義されていたものを、
// 副作用なしでimportできるようにするため、ロジックを一切変えずこのファイルへ移動した。
// レビュー評価55点+レビュー件数30点(200件で頭打ち)+リピート性15点=100点満点。
export function scoreItem(item) {
  const qualityScore = (item.reviewAverage / 5) * 55; // 品質: 最大55点
  const volumeScore = Math.min(item.reviewCount / 200, 1) * 30; // 実績: 最大30点(200件で頭打ち)
  const repeatScore = item.repeatSignal ? 15 : 0; // 購入頻度の高さ: 15点
  return Math.round(qualityScore + volumeScore + repeatScore);
}
