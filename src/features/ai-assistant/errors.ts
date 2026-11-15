import OpenAI from "openai";
import { AiConfigurationError } from "./configuration";

type AiFailure = { status: number; code: string; error: string; missing?: readonly string[]; retryAfter?: string };
/** Never forward provider messages, headers, keys, prompts or database errors. */
export function aiFailure(error: unknown, aborted = false): AiFailure | null {
  if (error instanceof AiConfigurationError) return { status: 503, code: "AI_CONFIGURATION_MISSING", missing: error.missing, error: `הגדרת Tayo AI חסרה בשרת: ${error.missing.join(", ")}. על הבעלים להגדיר את המשתנים בסביבת הפריסה ולבצע פריסה מחדש` };
  if (aborted || error instanceof OpenAI.APIConnectionTimeoutError || error instanceof OpenAI.APIUserAbortError) return { status: 504, code: "AI_TIMEOUT", error: "הבקשה ל־AI ארכה יותר מדי זמן. ניתן לנסות שוב" };
  if (error instanceof OpenAI.APIConnectionError) return { status: 502, code: "AI_CONNECTION_FAILED", error: "השרת לא הצליח להתחבר ל־OpenAI. נסו שוב מאוחר יותר" };
  if (error instanceof OpenAI.APIError) {
    if (error.status === 401) return { status: 503, code: "AI_PROVIDER_AUTH_FAILED", error: "OpenAI דחה את מפתח הגישה של השרת. יש לפנות לבעלים לבדיקת המפתח" };
    if (error.status === 403) return { status: 503, code: "AI_PROVIDER_ACCESS_DENIED", error: "OpenAI דחה את הבקשה עקב הרשאות או מגבלות גישה. יש לפנות לבעלים" };
    if (error.status === 404) return { status: 503, code: "AI_MODEL_UNAVAILABLE", error: "המודל המוגדר בשרת אינו זמין בחשבון OpenAI. יש לבדוק את OPENAI_MODEL ואת הרשאות החשבון" };
    if (error.status === 429) {
      const billing = error.type === "insufficient_quota" || ["insufficient_quota", "credit_balance_exhausted", "organization_spend_limit_exceeded", "project_spend_limit_exceeded", "organization_usage_limit_exceeded"].includes(error.code ?? "");
      return billing ? { status: 503, code: "AI_BILLING_LIMIT", error: "מכסת החיוב או התקציב בחשבון OpenAI נוצלה. על הבעלים לבדוק יתרה ומגבלות שימוש; ניסיון חוזר לבדו לא יפתור זאת" } : { status: 503, code: "AI_PROVIDER_RATE_LIMIT", error: "OpenAI הגביל זמנית את קצב הבקשות. נסו שוב מאוחר יותר", retryAfter: "60" };
    }
    if (error.status === 400 || error.status === 422) return { status: 502, code: "AI_REQUEST_REJECTED", error: "OpenAI דחה את מבנה הבקשה או את הגדרות המודל. נדרשת בדיקה בשרת" };
    if (error.status && error.status >= 500) return { status: 503, code: "AI_PROVIDER_UNAVAILABLE", error: "שירות OpenAI אינו זמין כרגע. נסו שוב מאוחר יותר", retryAfter: "60" };
  }
  if (error instanceof Error && ["INCOMPLETE_RESPONSE", "TOOL_LIMIT"].includes(error.message)) return { status: 502, code: "AI_RESPONSE_INCOMPLETE", error: "תשובת ה־AI לא הושלמה. נסו שוב או צמצמו את הבקשה" };
  return null;
}
export function reportAiFailure(failure: AiFailure) {
  // Safe operational metadata only. Do not log the original error object.
  console.error("Tayo AI request failed", { code: failure.code, status: failure.status, ...(failure.missing ? { missing: failure.missing } : {}) });
}
