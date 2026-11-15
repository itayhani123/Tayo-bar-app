// Explicitly authorized read-only audit. Never decrypts or prints environment values or credentials.
// node --env-file=.env.local scripts/check-ai-vercel-configuration.mjs
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const readJson = path => { try { return JSON.parse(readFileSync(path, "utf8")); } catch { return null; } };
const project = readJson(".vercel/project.json");
const repository = readJson(".vercel/repo.json");
const linked = project ? { id: project.projectId, orgId: project.orgId } : repository?.projects?.find(p => p.directory === ".");
const paths = [
  ...[process.env.APPDATA, process.env.LOCALAPPDATA].filter(Boolean).flatMap(base => [join(base, "com.vercel.cli", "auth.json"), join(base, "com.vercel.cli", "Data", "auth.json")]),
  join(homedir(), ".vercel", "auth.json"), join(homedir(), ".config", "vercel", "auth.json"),
  join(homedir(), ".config", "com.vercel.cli", "auth.json"), join(homedir(), ".local", "share", "com.vercel.cli", "auth.json"),
];
const token = process.env.VERCEL_TOKEN?.trim() || paths.filter(existsSync).map(path => readJson(path)?.token).find(Boolean);
const required = ["OPENAI_API_KEY", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SERVICE_ROLE_KEY"];

if (!linked?.id || !token) {
  console.log(JSON.stringify({ verified: false, linkedProject: Boolean(linked?.id), credentialAvailable: Boolean(token), reason: !token ? "NO_VERCEL_LOGIN_OR_ACCESS_TOKEN" : "PROJECT_NOT_LINKED" }));
  process.exitCode = 1;
} else {
  try {
    const url = new URL(`https://api.vercel.com/v10/projects/${encodeURIComponent(linked.id)}/env`);
    url.searchParams.set("decrypt", "false");
    if (linked.orgId) url.searchParams.set("teamId", linked.orgId);
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000) });
    if (!response.ok) {
      console.log(JSON.stringify({ verified: false, status: response.status }));
      process.exitCode = 1;
    } else {
      const body = await response.json();
      if (!Array.isArray(body.envs)) throw new Error("INVALID_METADATA");
      const entries = body.envs.map(e => ({ name: e.key, targets: Array.isArray(e.target) ? e.target : [e.target] }));
      console.log(JSON.stringify({ verified: true, scope: "current_project_settings_not_running_deployment", variables: [...required, "OPENAI_MODEL"].map(name => ({ name, production: entries.some(e => e.name === name && e.targets.includes("production")), targets: [...new Set(entries.filter(e => e.name === name).flatMap(e => e.targets))] })), otherOpenAINames: entries.filter(e => /openai/i.test(e.name) && ![...required, "OPENAI_MODEL"].includes(e.name)) }));
    }
  } catch { console.log(JSON.stringify({ verified: false, reason: "VERCEL_METADATA_REQUEST_FAILED" })); process.exitCode = 1; }
}
