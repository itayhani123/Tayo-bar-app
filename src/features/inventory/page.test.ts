import test from "node:test";
import assert from "node:assert/strict";
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {QueryClient,QueryClientProvider} from "@tanstack/react-query";
import {InventoryPage} from "./page";
import {inventoryDataSchema} from "./contract";
const empty={products:[],events:[],movements:[],reports:[],inbox:[],senders:[],costs:[],actorLabels:{},role:"manager",actor:"actor"};
function render(cache:QueryClient){try{return renderToStaticMarkup(createElement(QueryClientProvider,{client:cache},createElement(InventoryPage)));}finally{cache.clear();}}
test("inventory page renders loading, empty stock and products without undefined.map",()=>{
 assert.match(render(new QueryClient()),/טוען מלאי/);
 const cache=new QueryClient();cache.setQueryData(["inventory"],inventoryDataSchema.parse(empty));assert.match(render(cache),/לא נמצאו מוצרים/);
 const full=new QueryClient();full.setQueryData(["inventory"],inventoryDataSchema.parse({...empty,products:[{id:"product",name:"גרייגוס",category:"וודקה",bottle_ml:750,stock_qty:12,minimum_qty:2,active:true,aliases:[]}]}));const html=render(full);assert.match(html,/גרייגוס/);assert.doesNotMatch(html,/עלות לבקבוק/);
});
test("inventory API failure renders an error and retry button instead of business forms",async()=>{
 const cache=new QueryClient({defaultOptions:{queries:{retry:false}}});await assert.rejects(cache.fetchQuery({queryKey:["inventory"],queryFn:async()=>{throw new Error("סכמת המלאי אינה מעודכנת");}}));
 const html=render(cache);assert.match(html,/role="alert"/);assert.match(html,/סכמת המלאי אינה מעודכנת/);assert.match(html,/נסה שוב/);assert.doesNotMatch(html,/בדוק והכן אישור/);
});
