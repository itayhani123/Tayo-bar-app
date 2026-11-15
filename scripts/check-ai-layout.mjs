// Render the actual chat with production CSS, then check it in installed Chromium.
// npm run build first; node --import ./scripts/test-register.mjs scripts/check-ai-layout.mjs
// This tests layout only, not authenticated end-to-end behavior.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync, readdirSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AssistantChat } from "../src/features/ai-assistant/chat.tsx";
import { ConfirmationCard } from "../src/features/ai-assistant/confirmation-card.tsx";

const browserPath = process.env.AI_TEST_BROWSER || ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Google/Chrome/Application/chrome.exe"].find(existsSync);
assert.ok(browserPath, "Set AI_TEST_BROWSER to an installed Chromium executable");
const cssPaths = readdirSync(".next/static", { recursive: true }).filter(path => path.endsWith(".css"));
assert.ok(cssPaths.length, "Run npm run build first");
const css = cssPaths.map(path => readFileSync(resolve(".next/static", path), "utf8")).join("\n");
const output = resolve(".next/ai-layout");
mkdirSync(output, { recursive: true });
function htmlForRole(role) {
  const proposal = { id: "11111111-1111-4111-8111-111111111111", title: "עדכון אירוע", target: "לקוח לדוגמה · אפטאון · 2026-11-10", expiresAt: new Date(Date.now() + 600000).toISOString(), rows: [{ label: "מספר אורחים", before: "100", after: "150" }, ...(role === "owner" ? [{ label: "עמלת אולם", before: "700 ₪", after: "1,050 ₪" }] : [])], warnings: ["לא בוצע שינוי. יש לבדוק את הפרטים לפני אישור."] };
  const chat = renderToStaticMarkup(createElement(QueryClientProvider, { client: new QueryClient() }, createElement("div", null, createElement(AssistantChat, { role }), createElement("div", { className: "mx-auto mt-6 max-w-4xl" }, createElement(ConfirmationCard, { proposal })))));
  return `<!doctype html><html lang="he" dir="rtl"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><main class="px-5 py-6 lg:px-8 lg:py-8">${chat}</main></body></html>`;
}
const profile = resolve(output, `profile-${process.pid}`);
const browser = spawn(browserPath, ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { windowsHide: true, stdio: "ignore" });
let socket;
try {
  const activePortPath = resolve(profile, "DevToolsActivePort");
  const deadline = Date.now() + 20000;
  while (!existsSync(activePortPath) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 100));
  assert.ok(existsSync(activePortPath), "Chromium failed to start");
  const debugPort = readFileSync(activePortPath, "utf8").split("\n")[0];
  const pages = await (await fetch(`http://127.0.0.1:${debugPort}/json`)).json();
  socket = new WebSocket(pages.find(page => page.type === "page").webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true }); });
  let id = 0;
  const pending = new Map();
  socket.addEventListener("message", event => {
    const message = JSON.parse(event.data);
    if (message.id) { const callback = pending.get(message.id); pending.delete(message.id); callback?.(message); }
  });
  const command = (method, params = {}) => new Promise((resolve, reject) => {
    const requestId = ++id;
    const timer = setTimeout(() => { pending.delete(requestId); reject(new Error(`CDP timeout: ${method}`)); }, 10000);
    pending.set(requestId, message => { clearTimeout(timer); if (message.error) reject(new Error(message.error.message)); else resolve(message.result); });
    socket.send(JSON.stringify({ id: requestId, method, params }));
  });
  for (const role of ["owner", "manager"]) for (const width of [320, 390, 1280]) {
    await command("Emulation.setDeviceMetricsOverride", { width, height: 844, deviceScaleFactor: 1, mobile: width < 600 });
    await command("Page.navigate", { url: `data:text/html;charset=utf-8,${encodeURIComponent(htmlForRole(role))}` });
    let result;
    for (let attempt = 0; attempt < 50; attempt++) {
      result = await command("Runtime.evaluate", { expression: `(() => { const section = document.querySelector('section'); if (!section || document.readyState !== 'complete') return null; return { direction: getComputedStyle(section).direction, width: innerWidth, scrollWidth: document.documentElement.scrollWidth, textarea: document.querySelector('textarea').getBoundingClientRect().width, buttons: [...document.querySelectorAll('button')].map(b => b.getBoundingClientRect().height), financial: document.body.textContent.includes('כמה הרווחנו') }; })()`, returnByValue: true });
      if (result.result.value) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    const metrics = result.result.value;
    assert.ok(metrics, "Chat did not render");
    assert.equal(metrics.direction, "rtl");
    assert.ok(metrics.scrollWidth <= metrics.width, `Horizontal overflow at ${width}`);
    assert.ok(metrics.textarea >= 160, `Composer too narrow at ${width}`);
    assert.ok(metrics.buttons.every(height => height >= 44), "Touch targets must be at least 44px");
    assert.equal(metrics.financial, role === "owner");
    const screenshot = await command("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
    writeFileSync(resolve(output, `${role}-${width}.png`), Buffer.from(screenshot.data, "base64"));
    console.log(`PASS ${role} ${width}px: RTL, no overflow, readable composer, 44px controls`);
  }
} finally {
  socket?.close();
  browser.kill();
}
