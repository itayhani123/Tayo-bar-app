import test from "node:test";
import assert from "node:assert/strict";
import type {SupabaseClient} from "@supabase/supabase-js";
import {handleInventory} from "./http";
test("manager cannot edit prices, create products, receive stock, adjust or forge actors through API",async()=>{
 const actor="11111111-1111-4111-8111-111111111111";let calls=0;
 const db={auth:{getUser:async()=>({data:{user:{id:actor}},error:null})},from:()=>({select:()=>({eq:()=>({single:async()=>({data:{role:"manager"},error:null})})})}),rpc:async()=>{calls++;return{data:null,error:null};}} as unknown as SupabaseClient;
 const request=(body:unknown)=>new Request("https://tayo.test/api/inventory",{method:"POST",headers:{origin:"https://tayo.test","Content-Type":"application/json"},body:JSON.stringify(body)});
 const deps={client:async()=>db,admin:()=>db};
 const product={action:"product",id:null,values:{name:"גרייגוס",category:"וודקה",bottle_ml:750,cost_agorot:"9000",minimum_qty:2,active:true,aliases:[]}};
 assert.equal((await handleInventory(request(product),deps)).status,403);
 for(const kind of["receipt","adjustment"])assert.equal((await handleInventory(request({action:"prepare",kind,eventId:null,lines:[{product_id:actor,quantity:1}],key:actor,reason:"ספירה"}),deps)).status,403);
 assert.equal((await handleInventory(request({...product,actorId:actor}),deps)).status,400);
 assert.equal((await handleInventory(request({action:"permission",phone:"972501234567",enabled:true}),deps)).status,403);
 assert.equal(calls,0);
 const noOrigin=new Request("https://tayo.test/api/inventory",{method:"POST",body:JSON.stringify(product)});assert.equal((await handleInventory(noOrigin,deps)).status,403);
});

test("GET rejects missing RPC fields before map; distinguishes schema, RLS and other database failures safely",async()=>{
 const diagnostics:unknown[]=[];const original=console.error;console.error=(...args:unknown[])=>{diagnostics.push(args);};
 try{
  const empty={products:[],movements:[],reports:[],events:[],inbox:[],senders:[]};
  for(const [data,error,status,code]of[
   [empty,null,200,undefined],
   [{...empty,events:undefined},null,503,"INVENTORY_RESPONSE_INVALID"],
   [{...empty,inbox:undefined},null,503,"INVENTORY_RESPONSE_INVALID"],
   [null,{code:"PGRST202",message:"private phone 0501234567 sk-secret"},503,"INVENTORY_SCHEMA_MISSING"],
   [null,{code:"42703",message:"private column 0501234567"},503,"INVENTORY_SCHEMA_MISSING"],
   [null,{code:"42501",message:"private RLS"},403,"INVENTORY_PERMISSION_DENIED"],
   [null,{code:"08006",message:"private connection"},500,"INVENTORY_REQUEST_FAILED"],
  ] as const){
   const db={auth:{getUser:async()=>({data:{user:{id:"actor",email:"manager@example.test"}},error:null})},from:()=>({select:()=>({eq:()=>({single:async()=>({data:{role:"manager"},error:null})})})}),rpc:async(name:string)=>{assert.equal(name,"inventory_overview");return{data,error};}} as unknown as SupabaseClient;
   const response=await handleInventory(new Request("https://tayo.test/api/inventory"),{client:async()=>db,admin:()=>db});assert.equal(response.status,status);const body=await response.json();assert.equal(body.code,code);
   if(status===200){assert.deepEqual(body.products,[]);assert.deepEqual(body.inbox,[]);}else{assert.ok(body.diagnosticId);assert.doesNotMatch(JSON.stringify(body),/private|sk-secret|0501234567/);}
  }
  assert.doesNotMatch(JSON.stringify(diagnostics),/private|sk-secret|0501234567/);assert.match(JSON.stringify(diagnostics),/PGRST202|42703/);
 }finally{console.error=original;}
});
