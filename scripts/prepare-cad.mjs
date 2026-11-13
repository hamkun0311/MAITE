import { mkdir, copyFile } from "node:fs/promises";
import { resolve } from "node:path";

// Serve the pinned, single-threaded OpenCascade build from our own origin.
const source = resolve("node_modules/replicad-opencascadejs/dist");
await mkdir("public/wasm", { recursive: true });
await copyFile(
  resolve(source, "replicad_single.wasm"),
  "public/wasm/replicad_single.wasm",
);
await copyFile(
  resolve(source, "replicad_single.js"),
  "public/wasm/replicad_single.js",
);
await copyFile(resolve(source, "../LICENSE"), "public/wasm/LICENSE.txt");
console.log("OpenCascade WASM copied to public/wasm");
