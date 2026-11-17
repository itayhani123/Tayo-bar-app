export type AttendanceProcessingStage="sender_lookup"|"extraction"|"preview"|"pending_approval"|"correction";
const messages:Record<string,string>={
 WHATSAPP_WORKER_VERSION_MISMATCH:"גרסת הבוט בשרת אינה תואמת לסכמת מסד הנתונים. יש לפרוס את קוד הבוט המעודכן.",
 WHATSAPP_RESPONSE_INVALID:"מבנה נתוני המלאי אינו תואם לגרסת הבוט. נדרשת בדיקת inventory_catalog והמיגרציות.",
 WHATSAPP_SCHEMA_MISSING:"רכיב נוכחות נדרש חסר בסכמת מסד הנתונים. נדרשת בדיקת מיגרציות בפרויקט הנכון.",
 WHATSAPP_DATABASE_PERMISSION_DENIED:"מסד הנתונים דחה את הרשאות השרת. נדרשת בדיקת הרשאות החיבור.",
 WHATSAPP_AI_REQUEST_REJECTED:"שירות הפענוח דחה את הבקשה. נדרשת בדיקת הגדרת המודל והבקשה בשרת.",
 WHATSAPP_AI_CONFIGURATION_MISSING:"חסרה הגדרת OpenAI בשרת.",
 WHATSAPP_AI_CREDENTIAL_REJECTED:"שירות הפענוח דחה את הרשאת השרת.",
 WHATSAPP_AI_RATE_LIMITED:"שירות הפענוח עמוס או מוגבל. מתבצע ניסיון חוזר מוגבל.",
 WHATSAPP_PROCESSING_TIMEOUT:"העיבוד חרג מהזמן המותר. מתבצע ניסיון חוזר מוגבל.",
 PROCESSING_FAILED:"עיבוד הדיווח נכשל. יש לבדוק את השלב וקוד השגיאה בלוג השרת.",
};
export function attendanceFailureMessage(code:string){return messages[code]||messages.PROCESSING_FAILED;}
export function classifyAttendanceFailure(error:unknown,stage:AttendanceProcessingStage){
 const source=error&&typeof error==="object"?error as {message?:unknown;code?:unknown;databaseCode?:unknown;status?:unknown;name?:unknown;operation?:unknown}:{};
 const rawCode=source.databaseCode??source.code;
 const originalCode=typeof rawCode==="string"&&(/^(?:[A-Z0-9]{5}|PGRST\d{3})$/.test(rawCode)||["invalid_json_schema","invalid_api_key","model_not_found","rate_limit_exceeded","insufficient_quota"].includes(rawCode))?rawCode:undefined;
 const upstreamStatus=typeof source.status==="number"&&[400,401,403,404,408,409,422,429,500,502,503,504].includes(source.status)?source.status:undefined;
 let code="PROCESSING_FAILED",retryable=true;
 if(source.message==="WHATSAPP_WORKER_VERSION_MISMATCH"){code="WHATSAPP_WORKER_VERSION_MISMATCH";retryable=false;}
 else if(source.message==="INVENTORY_RESPONSE_INVALID"){code="WHATSAPP_RESPONSE_INVALID";retryable=false;}
 else if(["42703","42883","42P01","PGRST202","PGRST204","PGRST205"].includes(originalCode||"")){code="WHATSAPP_SCHEMA_MISSING";retryable=false;}
 else if(originalCode==="42501"){code="WHATSAPP_DATABASE_PERMISSION_DENIED";retryable=false;}
 else if(source.message==="AI_CONFIGURATION_MISSING"){code="WHATSAPP_AI_CONFIGURATION_MISSING";retryable=false;}
 else if(stage==="extraction"&&[401,403].includes(upstreamStatus||0)){code="WHATSAPP_AI_CREDENTIAL_REJECTED";retryable=false;}
 else if(stage==="extraction"&&[400,404,422].includes(upstreamStatus||0)){code="WHATSAPP_AI_REQUEST_REJECTED";retryable=false;}
 else if(stage==="extraction"&&upstreamStatus===429){code="WHATSAPP_AI_RATE_LIMITED";}
 else if(source.name==="AbortError"||source.name==="TimeoutError"||originalCode==="57014"){code="WHATSAPP_PROCESSING_TIMEOUT";}
 return {code,stage,retryable,safeMessage:attendanceFailureMessage(code),...(originalCode?{originalCode}:{}),...(upstreamStatus?{upstreamStatus}:{}),...(typeof source.operation==="string"&&/^[a-z_]{1,80}$/.test(source.operation)?{operation:source.operation}:{})};
}
