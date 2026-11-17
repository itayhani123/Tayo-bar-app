/** Classify intent only. Products, events and quantities are resolved by the
 * existing domain services; a routing decision never authorizes a write. */
export type WhatsAppReportType="attendance"|"inventory_consumption"|"inventory_receipt"|"clarification";
export function classifyWhatsAppReport(text:string):WhatsAppReportType{
 const normalized=text.normalize("NFKC").replace(/[\u200e\u200f]/g,"");
 const inventory=/(?:מלאי|אלכוהול|בקבוק(?:ים)?|צריכת\s*(?:בר|משקאות)|נצרכ[וה]?|צרכנו|השתמשנו\s*ב[־-]?|קבלת\s*סחורה)/.test(normalized);
 // A clock also recognizes malformed minutes so attendance can request a correction.
 const attendance=/(?:הגעה|כניסה|יציאה|נוכחות|שעות\s*עבודה)/.test(normalized)||/(?:^|[\s(])\d{1,2}:\d{1,2}\b/.test(normalized);
 if(inventory&&attendance)return "clarification";
 if(inventory){
  const receipt=/(?:התקבל(?:ה|ו)?|קיבל(?:נו|תי)|קבלת|קליטת|נכנס(?:ה|ו)?\s*(?:למלאי|סחורה)|הוספ(?:ת|נו|תי))/.test(normalized);
  const consumption=/(?:צריכ[הת]|נצרכ[וה]?|צרכנו|השתמשנו|נגמר[וה]?)/.test(normalized);
  if(receipt&&consumption)return "clarification";
  if(receipt)return "inventory_receipt";
  if(consumption)return "inventory_consumption";
  return "clarification"; // A count is not a stock receipt or event consumption.
 }
 return attendance?"attendance":"clarification";
}
export const reportClarification="מה תרצו לדווח? לנוכחות: ציינו אולם, תאריך ושעות עובדים. לצריכת אלכוהול: כתבו ׳צריכת אלכוהול׳, אולם, תאריך, מוצרים וכמויות. לקליטת סחורה: כתבו ׳התקבלו למלאי׳ עם מוצרים וכמויות. שלחו נוכחות ומלאי בהודעות נפרדות. לא נשמר דבר.";
