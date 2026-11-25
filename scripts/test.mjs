import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
const files = readdirSync("src", { recursive: true }).filter((path) => path.endsWith(".test.ts") && (!process.argv[2] || path.includes(process.argv[2]))).map((path) => `src/${path}`);
// Database tests embed independent PostgreSQL/WASM instances; bound file workers
// so the complete security suite does not exhaust memory alongside local tooling.
const result = spawnSync(process.execPath, ["--import", "./scripts/test-register.mjs", "--test", "--test-concurrency=2", ...files], { stdio: "inherit" });
process.exit(result.status ?? 1);
