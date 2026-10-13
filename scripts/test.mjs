import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
const files = readdirSync("src", { recursive: true }).filter((path) => path.endsWith(".test.ts") && (!process.argv[2] || path.includes(process.argv[2]))).map((path) => `src/${path}`);
const result = spawnSync(process.execPath, ["--import", "./scripts/test-register.mjs", "--test", ...files], { stdio: "inherit" });
process.exit(result.status ?? 1);
