export type InboxOperation = "authenticate" | "profile" | "server_configuration" | "read_senders" | "read_reports" | "configure_sender" | "confirm_report" | "read_report" | "preview_report" | "review_report" | "parse_request";
export type InboxDiagnostic = { requestId: string; operation: InboxOperation; code: string; status: number; databaseCode?: string };
export class InboxConfigurationError extends Error {
  constructor(public readonly missing: readonly string[]) { super("WHATSAPP_SERVER_CONFIGURATION_MISSING"); }
}
export function inboxFailure(error: unknown, aborted = false) {
  const source = error && typeof error === "object" ? error as { code?: unknown; status?: unknown; name?: unknown; message?: unknown } : {};
  const databaseCode = typeof source.code === "string" && /^(?:[0-9A-Z]{5}|PGRST\d{3})$/.test(source.code) ? source.code : undefined;
  const failure = (status: number, code: string, message: string) => ({ status, code, error: message, ...(databaseCode ? { databaseCode } : {}) });
  if (error instanceof InboxConfigurationError) return failure(500,"WHATSAPP_SERVER_CONFIGURATION_MISSING",`חסרה הגדרת שרת: ${error.missing.join(", ")}. יש לפנות לבעלים להגדרה ולפריסה מחדש`);
  if (aborted || databaseCode === "57014" || source.name === "AbortError" || source.name === "TimeoutError") return failure(504,"WHATSAPP_DATABASE_TIMEOUT","הפעולה ארכה יותר מדי זמן. בדקו את התוצאה לפני ניסיון נוסף");
  if (["PGRST202","42883"].includes(databaseCode ?? "")) return failure(500,"WHATSAPP_RPC_MISSING","פונקציית ניהול הדיווחים אינה זמינה במסד הנתונים. על הבעלים להחיל את מיגרציית התיקון 021 ולרענן את מטמון הסכמה");
  if (["42P01","PGRST205"].includes(databaseCode ?? "")) return failure(500,"WHATSAPP_TABLE_MISSING","טבלת דיווחי WhatsApp חסרה או אינה זמינה. יש לבדוק את התקנת מיגרציה 020 ואת פרויקט Supabase של סביבת Production");
  if (["42703","PGRST204"].includes(databaseCode ?? "")) return failure(500,"WHATSAPP_COLUMN_MISSING","סכמת דיווחי WhatsApp אינה תואמת לגרסת האפליקציה. נדרשת בדיקת הסכמה בשרת");
  if (databaseCode === "PGRST203") return failure(500,"WHATSAPP_RPC_SIGNATURE_CONFLICT","קיימת אי־התאמה בחתימת פונקציית ניהול הדיווחים. נדרשת בדיקת הסכמה בשרת");
  if (databaseCode === "42501") return failure(403,"WHATSAPP_PERMISSION_DENIED","הפעולה נדחתה עקב הרשאות. נדרשים חשבון בעלים והרשאות שרת מתאימות");
  if (["22023","22P02","23514","23502"].includes(databaseCode ?? "")) return failure(422,"WHATSAPP_INVALID_CONFIGURATION","פרטי ההרשאה אינם תקינים. יש לבחור חשבון owner או manager קיים ולבדוק את המספר");
  if (databaseCode === "23503") return failure(409,"WHATSAPP_ACCOUNT_CHANGED","החשבון שנבחר אינו זמין עוד או השתנה. רעננו את רשימת המשתמשים ובחרו מחדש");
  if (["23505","55P03","40001","40P01"].includes(databaseCode ?? "")) return failure(409,"WHATSAPP_CONFIGURATION_CONFLICT","הנתונים השתנו או מתבצע עדכון מקביל. רעננו ובדקו לפני ניסיון נוסף");
  if (databaseCode === "PGRST116") return failure(404,"WHATSAPP_REPORT_NOT_FOUND","הדיווח לא נמצא");
  if (["PGRST301","PGRST302"].includes(databaseCode ?? "") || source.status === 401 || source.status === 403) return failure(500,"WHATSAPP_SERVER_CREDENTIAL_REJECTED","הרשאת Supabase של השרת נדחתה. על הבעלים לבדוק את מפתח השירות ואת פרויקט Supabase");
  if (databaseCode?.startsWith("08") || ["PGRST000","PGRST001","PGRST002","PGRST003"].includes(databaseCode ?? "") || source.status === 503 || (typeof source.message === "string" && /fetch failed|failed to fetch|networkerror/i.test(source.message))) return failure(503,"WHATSAPP_DATABASE_UNAVAILABLE","החיבור למסד הנתונים אינו זמין כרגע. נסו שוב מאוחר יותר");
  return failure(500,"WHATSAPP_INTERNAL_ERROR","אירעה שגיאת שרת בניהול דיווחי WhatsApp. יש לפנות לבעלים עם מזהה הבדיקה");
}
export function logInboxFailure(diagnostic: InboxDiagnostic) {
  // Intentionally excludes request body, phone, actor/target IDs, email, original error/details/hint.
  console.error("WhatsApp attendance request failed", diagnostic);
}
