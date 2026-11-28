const API = "https://storage.googleapis.com";

export function createPrivateObjectStore({ bucket, accessToken, fetchImpl = fetch }) {
  if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket ?? "") || !accessToken?.trim()) {
    throw new Error("PRIVATE_STORAGE_CONFIG_REQUIRED");
  }
  const headers = { Authorization: `Bearer ${accessToken}` };
  const objects = `${API}/storage/v1/b/${bucket}/o`;
  async function request(url, options) {
    return fetchImpl(url, { ...options, redirect: "error", signal: AbortSignal.timeout(30_000),
      headers: { ...headers, ...options?.headers } });
  }
  return {
    async read(name) {
      const response = await request(`${objects}/${encodeURIComponent(name)}?alt=media`);
      if (response.status === 404) return null;
      if (!response.ok) throw new Error("PRIVATE_STORAGE_READ_FAILED");
      return response.json();
    },
    async latest(prefix, before) {
      let latest = null;
      let pageToken;
      do {
        const query = new URLSearchParams({ prefix, fields: "nextPageToken,items(name)" });
        if (pageToken) query.set("pageToken", pageToken);
        const response = await request(`${objects}?${query}`);
        if (!response.ok) throw new Error("PRIVATE_STORAGE_LIST_FAILED");
        const page = await response.json();
        for (const { name } of page.items ?? []) {
          const key = name.slice(prefix.length);
          if (name.startsWith(prefix) && /^\d{4}-\d{2}-\d{2}\.json$/.test(key) &&
              key.slice(0, 10) < before && (latest === null || name > latest)) latest = name;
        }
        pageToken = page.nextPageToken;
      } while (pageToken);
      if (latest === null) return null;
      const value = await this.read(latest);
      if (!value || value.asOf !== latest.slice(-15, -5)) throw new Error("PRIVATE_SNAPSHOT_ID_MISMATCH");
      return value;
    },
    async create(name, value) {
      const query = new URLSearchParams({ uploadType: "media", name, ifGenerationMatch: "0" });
      const response = await request(`${API}/upload/storage/v1/b/${bucket}/o?${query}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value),
      });
      if (response.status === 412) return "ALREADY_EXISTS";
      if (!response.ok) throw new Error("PRIVATE_STORAGE_WRITE_FAILED");
      return "CREATED";
    },
  };
}
