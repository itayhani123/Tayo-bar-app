import test from "node:test";
import assert from "node:assert/strict";
import {INVENTORY_POLICY,resolveInventory,type InventoryExtraction,type Product} from "./domain";
const product:Product={id:"p",name:"גרייגוס",category:"וודקה",bottle_ml:750,cost_agorot:"12500",stock_qty:80,minimum_qty:0,active:true,aliases:["גריי גוס"]};
const input:InventoryExtraction={kind:"receipt",venue:null,day:null,month:null,year:null,entries:[{name:"בקבוקי גרייגוס",quantity:70}]};
test("v1 resolves quantity-unit product mentions only with source evidence",()=>{
 assert.equal(INVENTORY_POLICY,"inventory_bottles_v1");
 for(const unit of ["בקבוקי","בקבוקים","בקבוק"]){
  const data={...input,entries:[{name:`${unit} גרייגוס`,quantity:70}]};
  assert.deepEqual(resolveInventory(data,[product],[],`התקבלו למלאי 70 ${unit} גרייגוס`).lines,[{product_id:"p",quantity:70}]);
 }
 assert.throws(()=>resolveInventory(input,[product],[],"70 מוצר אחר"),/לא נמצא מוצר/);
 assert.throws(()=>resolveInventory(input,[],[],"התקבלו למלאי 70 בקבוקי גרייגוס"),/מוצר קיים/);
});
test("real unit-prefixed brands and v1 bottle-size distinctions are preserved",()=>{
 const actual={...product,id:"brand",name:"בקבוקי גרייגוס"};
 assert.equal(resolveInventory(input,[product,actual],[],"70 בקבוקי גרייגוס").lines[0].product_id,"brand");
 assert.throws(()=>resolveInventory(input,[product,{...product,id:"liter",bottle_ml:1000}],[],"70 בקבוקי גרייגוס"),/כמה מוצרים/);
 const sized={...input,entries:[{name:'בקבוקי גרייגוס 750 מ״ל',quantity:70}]};
 assert.equal(resolveInventory(sized,[product],[],'70 בקבוקי גרייגוס 750 מ״ל').lines[0].product_id,"p");
});
test("consumption respects explicit event type and never creates unknown products",()=>{
 const events=[{id:"brit",venue_name:"אפטאון",client_name:"כהן",event_date:"2026-11-17",event_type:"Brit"},{id:"bar",venue_name:"אפטאון",client_name:"כהן",event_date:"2026-11-17",event_type:"Bar Mitzvah"}];
 const used:InventoryExtraction={...input,kind:"consumption",venue:"ברית באפטאון",day:17,month:11,year:2026,entries:[{name:"גרייגוס",quantity:12}]};
 assert.equal(resolveInventory(used,[product],events).event?.id,"brit");
 assert.throws(()=>resolveInventory({...used,venue:"אפטאון"},[product],events),/כמה אירועים/);
 assert.throws(()=>resolveInventory(used,[],events),/מוצר קיים/);
 assert.throws(()=>resolveInventory({...used,entries:[{name:"גרייגוס",quantity:81}]},[product],events),/אין מספיק מלאי/);
});
