import { AI_TRANSPORT_VERSION } from "./transport-version";

export type SendDiagnostic = { stage: "preparing" | "sending" | "received" | "failed"; code?: string; status?: number; requestId?: string; serverVersion?: string };
export class AiClientError extends Error {
  constructor(message: string, public readonly code: string) { super(message); this.name = "AiClientError"; }
}
export function newAiRequestId(cryptoApi: Pick<Crypto, "getRandomValues"> & Partial<Pick<Crypto, "randomUUID">> = globalThis.crypto): string {
  if (typeof cryptoApi?.randomUUID === "function") return cryptoApi.randomUUID();
  if (typeof cryptoApi?.getRandomValues !== "function") throw new AiClientError("הבקשה לא נשלחה: הדפדפן אינו תומך ביצירת מזהה מאובטח. פתחו את האתר בדפדפן מעודכן ובכתובת HTTPS", "CLIENT_CRYPTO_UNAVAILABLE");
  const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
  const hex = [...bytes].map(b => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
export async function requestAiJson<T>(url: string, options: { body?: unknown; requestId?: string; signal?: AbortSignal; timeoutMs?: number; diagnostic?: (value: SendDiagnostic) => void } = {}, fetcher: typeof fetch = globalThis.fetch): Promise<T> {
  const { requestId, diagnostic } = options;
  let timedOut = false;
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (options.signal?.aborted) controller.abort();
  options.signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, options.timeoutMs ?? 55000);
  let response: Response | undefined;
  try {
    diagnostic?.({ stage: "sending", requestId });
    response = await fetcher(url, { method: options.body === undefined ? "GET" : "POST", credentials: "same-origin", headers: { ...(options.body === undefined ? {} : { "Content-Type": "application/json" }), "X-Tayo-AI-Client-Version": AI_TRANSPORT_VERSION, ...(requestId ? { "X-Tayo-AI-Request-Id": requestId } : {}) }, ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }), signal: controller.signal, cache: "no-store", redirect: "follow" });
    const serverVersion = response.headers.get("X-Tayo-AI-Version") === AI_TRANSPORT_VERSION ? AI_TRANSPORT_VERSION : "unknown-or-older";
    diagnostic?.({ stage: "received", status: response.status, requestId, serverVersion });
    if (response.redirected) throw new AiClientError("הבקשה הופנתה לעמוד אחר. ייתכן שההתחברות פגה; התחברו מחדש ונסו שוב", "AUTH_REDIRECT");
    let data: unknown;
    try { data = await response.json(); } catch (error) { if (controller.signal.aborted) throw error; throw new AiClientError(`השרת החזיר תשובה שאינה JSON (HTTP ${response.status}). נסו לרענן את העמוד`, "NON_JSON_RESPONSE"); }
    if (!response.ok) {
      const payload = data && typeof data === "object" ? data as Record<string, unknown> : {};
      const code = typeof payload.code === "string" && /^[A-Z0-9_]{1,80}$/.test(payload.code) ? payload.code : `HTTP_${response.status}`;
      throw new AiClientError(typeof payload.error === "string" && payload.error.trim() ? payload.error : response.status === 401 ? "ההתחברות פגה. יש להתחבר מחדש" : `בקשת ה־AI נכשלה (HTTP ${response.status})`, code);
    }
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new AiClientError("השרת החזיר תשובה במבנה לא תקין", "INVALID_RESPONSE");
    return data as T;
  } catch (error) {
    const safe = error instanceof AiClientError ? error : new AiClientError(timedOut ? "הבקשה לא הושלמה בזמן. אפשר לנסות שוב; אם הבעיה נמשכת יש לרענן את העמוד" : options.signal?.aborted ? "הבקשה בוטלה" : "לא התקבלה תשובה מהשרת. בדקו חיבור לרשת ונסו שוב", timedOut ? "CLIENT_TIMEOUT" : options.signal?.aborted ? "CLIENT_ABORTED" : "CLIENT_NETWORK_FAILED");
    diagnostic?.({ stage: "failed", code: safe.code, requestId, ...(response ? { status: response.status, serverVersion: response.headers.get("X-Tayo-AI-Version") === AI_TRANSPORT_VERSION ? AI_TRANSPORT_VERSION : "unknown-or-older" } : {}) });
    throw safe;
  } finally { clearTimeout(timer); options.signal?.removeEventListener("abort", abort); }
}
