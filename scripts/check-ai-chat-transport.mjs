// Hydrated browser regression checks of the real chat. Synthetic local HTTP only; no auth bypass in app routes.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";

const require=createRequire(import.meta.url);
const output=resolve(".next/ai-chat-transport");mkdirSync(output,{recursive:true});
const loader=resolve(output,"typescript-loader.cjs");
writeFileSync(loader,`module.exports=function(source){return require(${JSON.stringify(require.resolve("typescript"))}).transpileModule(source,{compilerOptions:{target:9,module:99,jsx:4}}).outputText;};`);
writeFileSync(resolve(output,"link.tsx"),'import React from "react"; export default function Link(props) { return React.createElement("a", props); }');
writeFileSync(resolve(output,"entry.tsx"),`
import React from "react";import {createRoot} from "react-dom/client";import {QueryClient,QueryClientProvider} from "@tanstack/react-query";
import {AssistantChat} from ${JSON.stringify(resolve("src/features/ai-assistant/chat.tsx"))};
const mode=new URLSearchParams(location.search).get("mode");localStorage.clear();
if(mode==="restore-hang"||mode==="restore-error")localStorage.setItem("tayo-ai-conversation:synthetic:manager","11111111-1111-4111-8111-111111111111");
if(mode.endsWith("compat")){Object.defineProperty(crypto,"randomUUID",{configurable:true,value:undefined});Object.defineProperty(AbortSignal,"any",{configurable:true,value:undefined});Object.defineProperty(AbortSignal,"timeout",{configurable:true,value:undefined});}
if(mode==="crypto-error"){Object.defineProperty(crypto,"randomUUID",{configurable:true,value:undefined});Object.defineProperty(crypto,"getRandomValues",{configurable:true,value:undefined});window.repairCrypto=()=>{delete crypto.randomUUID;delete crypto.getRandomValues;};}
createRoot(document.getElementById("root")).render(<QueryClientProvider client={new QueryClient()}><AssistantChat role="manager" userId="synthetic"/></QueryClientProvider>);
`);
const compiled=require("next/dist/compiled/webpack/webpack");
await new Promise((done,reject)=>compiled.webpack({mode:"development",devtool:false,entry:resolve(output,"entry.tsx"),output:{path:output,filename:"browser.js"},resolve:{extensions:[".tsx",".ts",".js"],alias:{"@":resolve("src"),"next/link.js":resolve(output,"link.tsx")}},module:{rules:[{test:/\.tsx?$/,exclude:/node_modules/,use:loader}]},optimization:{minimize:false}},(error,stats)=>error?reject(error):stats.hasErrors()?reject(new Error(stats.toString({all:false,errors:true}))):done()));
let mode="",posts=0,gets=0;
const server=createServer(async(request,response)=>{
 if(request.url==="/browser.js"){response.writeHead(200,{"Content-Type":"text/javascript"});response.end(readFileSync(resolve(output,"browser.js")));return;}
 if(request.url.startsWith("/api/ai-assistant")){
  if(request.method==="GET"){gets++;if(mode==="restore-hang")return;response.writeHead(503,{"Content-Type":"application/json"});response.end(JSON.stringify({error:"Tayo AI עדיין לא הוגדר בשרת"}));return;}
  posts++;const chunks=[];for await(const chunk of request)chunks.push(chunk);const body=JSON.parse(Buffer.concat(chunks));
  if(request.url==="/api/ai-assistant/attendance"){assert.equal(body.action,"extract");response.writeHead(200,{"Content-Type":"application/json"});response.end(JSON.stringify({extracted:{venue:null,day:null,month:null,year:null,weekday:null,entries:[]},events:[],employees:[],rows:[],issues:[],eventId:null}));return;}
  assert.equal(request.headers["x-tayo-ai-request-id"],body.requestId);assert.match(body.requestId,/^[0-9a-f-]{36}$/);
  if(mode==="server-error"){response.writeHead(503,{"Content-Type":"application/json"});response.end(JSON.stringify({error:"Tayo AI עדיין לא הוגדר בשרת"}));return;}
  response.writeHead(200,{"Content-Type":"application/json","X-Tayo-AI-Version":"chat-transport-v2"});response.end(JSON.stringify({answer:"תשובה סינתטית",conversationId:body.conversationId,proposals:[],choices:[],messages:[{role:"user",content:body.message},{role:"assistant",content:"תשובה סינתטית"}]}));return;
 }
 response.writeHead(200,{"Content-Type":"text/html; charset=utf-8"});response.end('<!doctype html><html lang="he" dir="rtl"><body><div id="root"></div><script src="/browser.js"></script></body></html>');
});
await new Promise(done=>server.listen(0,"127.0.0.1",done));const port=server.address().port;
const browserPath=process.env.AI_TEST_BROWSER||["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe","C:/Program Files/Google/Chrome/Application/chrome.exe"].find(existsSync);
assert.ok(browserPath,"No installed Chromium browser");
const profile=resolve(output,`profile-${process.pid}`);
const browser=spawn(browserPath,["--headless=new","--disable-gpu","--no-first-run","--no-default-browser-check","--remote-debugging-port=0",`--user-data-dir=${profile}`,"about:blank"],{windowsHide:true,stdio:"ignore"});
let socket;
try{
 const active=resolve(profile,"DevToolsActivePort");const deadline=Date.now()+20000;
 while(!existsSync(active)&&Date.now()<deadline)await new Promise(done=>setTimeout(done,100));assert.ok(existsSync(active),"Browser did not start");
 const pages=await(await fetch(`http://127.0.0.1:${readFileSync(active,"utf8").split("\n")[0]}/json`)).json();
 socket=new WebSocket(pages.find(page=>page.type==="page").webSocketDebuggerUrl);
 await new Promise((done,reject)=>{socket.addEventListener("open",done,{once:true});socket.addEventListener("error",reject,{once:true});});
 let sequence=0;const pending=new Map();const exceptions=[];
 socket.addEventListener("message",event=>{const m=JSON.parse(event.data);if(m.id){const cb=pending.get(m.id);pending.delete(m.id);cb?.(m);}else if(m.method==="Runtime.exceptionThrown")exceptions.push(m.params.exceptionDetails.text);});
 const command=(method,params={})=>new Promise((done,reject)=>{const id=++sequence;const timer=setTimeout(()=>reject(new Error(`CDP timeout: ${method}`)),10000);pending.set(id,m=>{clearTimeout(timer);if(m.error)reject(new Error(m.error.message));else done(m.result);});socket.send(JSON.stringify({id,method,params}));});
 const evaluate=async(expression)=>(await command("Runtime.evaluate",{expression,returnByValue:true,awaitPromise:true})).result.value;
 const wait=async(expression)=>{for(let i=0;i<120;i++){if(await evaluate(expression))return;await new Promise(done=>setTimeout(done,50));}throw new Error(`Browser expectation timed out: ${expression}`);};
 const fill=async(text)=>evaluate(`(()=>{const t=document.querySelector('textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(t,${JSON.stringify(text)});t.dispatchEvent(new Event('input',{bubbles:true}));})()`);
 const submit=()=>evaluate(`document.querySelector('button[type="submit"]').click()`);
 await command("Runtime.enable");
 for(mode of ["compat","attendance-compat","long-message","crypto-error","restore-hang","restore-error","server-error"]){
  posts=0;gets=0;exceptions.length=0;
  await command("Page.navigate",{url:`http://127.0.0.1:${port}/?mode=${mode}`});
  if(mode==="restore-hang"){
   await wait(`document.querySelector('textarea') && document.querySelector('textarea').disabled`);
   await evaluate(`document.querySelector('button[aria-label="פתיחת שיחה חדשה"]').click()`);
  }
  await wait(`document.querySelector('textarea') && !document.querySelector('textarea').disabled`);
  if(mode==="long-message"){
   await fill("x".repeat(2001));await submit();await wait(`document.querySelector('[role="alert"]')?.textContent.includes('2,000')`);assert.equal(posts,0);
  }
  await fill(mode==="attendance-compat"?"הגעה\nנדב 19:00\nיציאה\nנדב 02:00":"בדיקה סינתטית");await submit();
  if(mode==="crypto-error"){
   await wait(`document.body.textContent.includes('הבקשה לא נשלחה')`);assert.equal(posts,0);
   await evaluate(`window.repairCrypto()`);await submit();
  }
  if(mode==="attendance-compat"){
   await wait(`document.body.textContent.includes('0 עובדים מזוהים')`);
  }else if(mode==="server-error"){
   await wait(`document.querySelector('[role="alert"]')?.textContent.includes('לא הוגדר')`);
   assert.ok(await evaluate(`document.body.textContent.includes('HTTP 503') && document.body.textContent.includes('unknown-or-older')`));
  }else{
   await wait(`document.body.textContent.includes('תשובה סינתטית')`);
   assert.ok(!await evaluate(`!!document.querySelector('[role="alert"]')?.textContent.includes('לא הוגדר')`));
  }
  assert.equal(posts,1,`One POST required for ${mode}`);assert.deepEqual(exceptions,[],`Uncaught browser exceptions in ${mode}`);
  if(mode.startsWith("restore"))assert.ok(gets>=1);
  console.log(`PASS hydrated chat: ${mode}, actual form submit, one local POST, no uncaught JS exceptions`);
 }
}finally{socket?.close();browser.kill();server.closeAllConnections();await new Promise(done=>server.close(done));}
