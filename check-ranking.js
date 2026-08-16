const appId = process.env.RAKUTEN_APP_ID;
const accessKey = process.env.RAKUTEN_SECRET;

const url = new URL("https://openapi.rakuten.co.jp/ichibaranking/api/IchibaItem/Ranking/20220601");
url.searchParams.set("applicationId", appId);
url.searchParams.set("accessKey", accessKey);
url.searchParams.set("genreId", "0"); // 総合ランキング
url.searchParams.set("period", "realtime");
url.searchParams.set("format", "json");

const res = await fetch(url, {
  headers: { accessKey, Authorization: `Bearer ${accessKey}` },
});
const data = await res.json();
console.log("status:", res.status);
console.log(JSON.stringify(data).slice(0, 500));
if (data.error) {
  console.error("APIエラー:", data.error, data.error_description);
  process.exit(1);
}
for (const item of data.Items ?? []) {
  const i = item.Item;
  console.log(`${i.rank}. [${i.genreId}] ${i.itemName.slice(0, 50)} / ¥${i.itemPrice}`);
}
