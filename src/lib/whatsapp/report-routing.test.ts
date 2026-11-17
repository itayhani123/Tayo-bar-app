import test from "node:test";
import assert from "node:assert/strict";
import {classifyWhatsAppReport} from "./report-routing";

test("classifies inventory receipts, consumption and attendance before parsing; uncertain intent never defaults to attendance",()=>{
 for(const text of["צריכת אלכוהול\nאפטאון 15/11\n4 גרייגוס", "באירוע אפטאון השתמשנו ב־4 גרייגוס", "נצרכו באפטאון 4 בקבוקי גרייגוס", "צרכנו באירוע 2 בקבוקים"])assert.equal(classifyWhatsAppReport(text),"inventory_consumption",text);
 for(const text of["התקבלו למלאי 12 גרייגוס", "קיבלנו 12 בקבוקים", "קליטת מלאי\n12 גרייגוס", "קבלת סחורה\n12 גרייגוס"])assert.equal(classifyWhatsAppReport(text),"inventory_receipt",text);
 for(const text of["הגעה\nנדב 19:00\nיציאה\nנדב 02:10", "יום ראשון 15/11\nאפטאון\nיונתן לולו 12:30-17:35", "יונתן 12:30-17:3"])assert.equal(classifyWhatsAppReport(text),"attendance",text);
 for(const text of["שלום", "4 גרייגוס", "ספירת מלאי 4 גרייגוס", "צריכת אלכוהול\nהגעה\nנדב 19:00", "דיווח מלאי", "התקבלו למלאי 12 בקבוקים ונצרכו 4 באירוע"])assert.equal(classifyWhatsAppReport(text),"clarification",text);
});
