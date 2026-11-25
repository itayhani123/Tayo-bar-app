import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyWhatsAppIntent,whatsappAiProviderConfigured} from './ai-routing';
import {assertAiToolAccess} from './ai-reader';
test('only clear, standalone read questions reach AI',()=>{
 for(const text of ['מי עובד מחר?','אילו אירועים יש השבוע?','כמה הרווחנו החודש?','מה זה מע״מ?'])assert.equal(classifyWhatsAppIntent(text),'general_question',text);
 for(const text of ['כן','2','בטל','גרייגוס 70','עדן 12-16','מלאי 70','מה עושים עם מלאי 70','מי עובד מחר? הוסף אירוע','מה מצב הנוכחות','שאלה\n12:30','אשר את זה'])assert.notEqual(classifyWhatsAppIntent(text),'general_question',text);
 assert.equal(classifyWhatsAppIntent('התקבלו למלאי 70 בקבוקי גרייגוס'),'inventory_receipt');
 assert.equal(classifyWhatsAppIntent('צריכת אלכוהול 12 בקבוקים'),'inventory_consumption');
 assert.equal(classifyWhatsAppIntent('הגעה 12:30 יציאה 16:55'),'attendance');
 assert.equal(classifyWhatsAppIntent('התקבלו 3 בקבוקים הגעה 12:30'),'clarification');
});
test('tool authorization rejects unknown roles, mutations and manager finances before reading',()=>{
 assert.doesNotThrow(()=>assertAiToolAccess('manager','operations'));
 for(const name of ['financial_summary','receivables','venue_closings','propose_create_event','delete','sql'])assert.throws(()=>assertAiToolAccess('manager',name),/FORBIDDEN_TOOL/);
 for(const name of ['operations','financial_summary'])assert.throws(()=>assertAiToolAccess('employee',name),/FORBIDDEN_TOOL/);
 for(const name of ['operations','financial_summary','receivables','venue_closings'])assert.doesNotThrow(()=>assertAiToolAccess('owner',name));
});
test('AI provider key is required and must differ from the reporting/application key',()=>{
 const app=process.env.OPENAI_API_KEY,ai=process.env.WHATSAPP_AI_OPENAI_API_KEY;
 try{
  process.env.OPENAI_API_KEY='synthetic-report-key';delete process.env.WHATSAPP_AI_OPENAI_API_KEY;assert.equal(whatsappAiProviderConfigured(),false);
  process.env.WHATSAPP_AI_OPENAI_API_KEY='synthetic-report-key';assert.equal(whatsappAiProviderConfigured(),false);
  process.env.WHATSAPP_AI_OPENAI_API_KEY='synthetic-dedicated-key';assert.equal(whatsappAiProviderConfigured(),true);
 }finally{if(app===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=app;if(ai===undefined)delete process.env.WHATSAPP_AI_OPENAI_API_KEY;else process.env.WHATSAPP_AI_OPENAI_API_KEY=ai;}
});
