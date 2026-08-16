const appId = process.env.RAKUTEN_APP_ID;
const accessKey = process.env.RAKUTEN_SECRET;
const affiliateId = process.env.RAKUTEN_AFFILIATE_ID;

if (!appId || !accessKey) {
  console.error("RAKUTEN_APP_ID または RAKUTEN_SECRET が .env に設定されていません。");
  process.exit(1);
}

const url = new URL("https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20220601");
url.searchParams.set("applicationId", appId);
url.searchParams.set("accessKey", accessKey);
if (affiliateId) url.searchParams.set("affiliateId", affiliateId);
url.searchParams.set("keyword", "コーヒー");
url.searchParams.set("hits", "3");
url.searchParams.set("format", "json");

const res = await fetch(url, {
  headers: {
    accessKey: accessKey,
    Authorization: `Bearer ${accessKey}`,
  },
});
const data = await res.json();
if (!res.ok) {
  console.error(`HTTP ${res.status}`);
}

if (data.error) {
  console.error("APIエラー:", data.error, data.error_description);
  process.exit(1);
}

console.log(`取得件数: ${data.Items?.length ?? 0}`);
for (const item of data.Items ?? []) {
  const i = item.Item;
  console.log(`- ${i.itemName} / ¥${i.itemPrice} / ${i.itemUrl}`);
}
