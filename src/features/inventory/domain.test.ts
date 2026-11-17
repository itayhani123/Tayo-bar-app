import test from "node:test";
import assert from "node:assert/strict";
import {isInventoryMessage,resolveInventory,inventorySummary,parseAgorot,formatAgorot,parseInventoryButton,type Product,type InventoryExtraction} from "./domain";
import {effectiveAlcoholCost} from "./costs";
const products:Product[]=[{id:"g",name:"גרייגוס",category:"וודקה",bottle_ml:750,stock_qty:10,minimum_qty:2,active:true,aliases:["גריי גוס"]},{id:"j",name:"ג'יימסון",category:"ויסקי",bottle_ml:700,stock_qty:10,minimum_qty:2,active:true,aliases:[]},{id:"a",name:"ערק",category:"אניס",bottle_ml:750,stock_qty:10,minimum_qty:2,active:true,aliases:[]}];
const events=[{id:"event",venue_name:"אפטאון",event_date:"2026-11-15",client_name:"מעיין"}];
const input:InventoryExtraction={kind:"consumption",venue:"אפטאון",day:15,month:11,year:null,entries:[{name:"גרייגוס",quantity:4},{name:"ג'יימסון",quantity:3},{name:"ערק",quantity:2}]};
test("inventory is separated from attendance; product and event matching fails closed",()=>{
 for(const text of["צריכת אלכוהול\nאפטאון 15/11\n4 גרייגוס","באירוע אפטאון השתמשנו ב־4 גרייגוס, 3 ג'יימסון ו־2 ערק","התקבלו למלאי 12 גרייגוס ו־6 ג'יימסון"])assert.equal(isInventoryMessage(text),true);
 assert.equal(isInventoryMessage("הגעה\nנדב 19:00\nיציאה\nנדב 02:10"),false);
 const resolved=resolveInventory(input,products,events);assert.equal(resolved.lines.length,3);assert.equal(resolved.lines.reduce((s,l)=>s+l.quantity,0),9);
 const summary=inventorySummary(input.kind,resolved.event,resolved.lines,products);assert.match(summary,/סה״כ: 9/);assert.doesNotMatch(summary,/cost|₪|UUID|בטל [A-F0-9]/);
 assert.throws(()=>resolveInventory({...input,venue:"לא מוכר"},products,events),/לא נמצא אירוע/);
 assert.throws(()=>resolveInventory(input,products,[...events,{...events[0],id:"other"}]),/כמה אירועים/);
 assert.throws(()=>resolveInventory({...input,entries:[{name:"לא קיים",quantity:1}]},products,events),/לא נמצא מוצר/);
 assert.throws(()=>resolveInventory(input,[...products,{...products[0],id:"litre",bottle_ml:1000}],events),/נפח בקבוק/);
 assert.throws(()=>resolveInventory({...input,entries:[{name:"גרייגוס",quantity:11}]},products,events),/אין מספיק מלאי/);
 assert.throws(()=>resolveInventory({...input,entries:[{name:"גרייגוס",quantity:0.5}]},products,events),/שלם וחיובי/);
 assert.equal(parseInventoryButton("אשר 1234"),null);
});
test("integer agorot are exact; approved zero replaces estimates rather than adding to them",()=>{
 assert.equal(parseAgorot("90.01"),"9001");assert.equal(formatAgorot("9001"),"₪90.01");assert.throws(()=>parseAgorot("1.005"));
 assert.equal(effectiveAlcoholCost(1000,"67500"),675);assert.equal(effectiveAlcoholCost(1000,"0"),0);assert.equal(effectiveAlcoholCost(1000,undefined),1000);
});
