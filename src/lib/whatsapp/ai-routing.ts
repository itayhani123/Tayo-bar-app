import {classifyWhatsAppReport,type WhatsAppReportType} from './report-routing';
export type WhatsAppIntent=WhatsAppReportType|'general_question';
export const whatsappAiEnabled=()=>process.env.WHATSAPP_AI_FALLBACK_ENABLED==='true';
export const whatsappAiProviderConfigured=()=>{
 const key=process.env.WHATSAPP_AI_OPENAI_API_KEY?.trim();
 return Boolean(key&&key!==process.env.OPENAI_API_KEY?.trim());
};
export function classifyWhatsAppIntent(text:string):WhatsAppIntent{
 const report=classifyWhatsAppReport(text);
 if(report!=='clarification')return report;
 const t=text.normalize('NFKC').replace(/[\u200e\u200f]/g,'').trim();
 // Conservative first release: domain mentions, mutations, fragments, multiline
 // reports and bare decisions never fall through to the model.
 if(t.length>2000||/[\r\n\d]/.test(t)||/(?:מלאי|בקבוק|אלכוהול|נוכחות|הגעה|יציאה|כניסה|דיווח|משמרת|שעות|עבדתי|אשר|אישור|תאשר|בטל|ביטול|תבטל|הוסף|תוסיף|הוספ|עדכן|עדכ|מחק|למחוק|שמור|תשמור|צור|ליצור|יצירה|תיצור|תשנה|שינוי|שנה את|רשום|תרשום|שבץ|שיבוץ|תשבץ|התקבל|השתמש|צריכה|קליטה|קבלה)/u.test(t))return 'clarification';
 return /^(?:מה|מי|מתי|איפה|איך|כיצד|למה|מדוע|האם|כמה|אילו|איזה)\s+\S/u.test(t)?'general_question':'clarification';
}
