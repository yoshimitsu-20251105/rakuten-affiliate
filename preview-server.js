import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";

const ROOT = new URL("./docs/", import.meta.url);
const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css" };

createServer(async (req, res) => {
  let path = req.url === "/" ? "/index.html" : req.url;
  try {
    const data = await readFile(new URL("." + path, ROOT));
    res.writeHead(200, { "Content-Type": TYPES[extname(path)] || "text/plain" });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
}).listen(4173, () => console.log("Preview server on http://localhost:4173"));
