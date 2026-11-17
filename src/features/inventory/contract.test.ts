import test from "node:test";
import assert from "node:assert/strict";
import {inventoryOverviewSchema,loadInventory} from "./contract";
export const emptyInventory={products:[],events:[],movements:[],reports:[],inbox:[],senders:[],costs:[],actorLabels:{},role:"manager",actor:"actor"};
const fetchResult=(value:unknown,status=200)=>(async()=>Response.json(value,{status})) as typeof fetch;
test("valid empty inventory is distinct from an incompatible API response",async()=>{
 assert.deepEqual((await loadInventory(fetchResult(emptyInventory))).products,[]);
 for(const key of["inbox","products","movements","reports","events","senders"]){const malformed={...emptyInventory,[key]:undefined};assert.equal(inventoryOverviewSchema.safeParse(malformed).success,false);await assert.rejects(loadInventory(fetchResult(malformed)),/אינם תואמים/);}
 await assert.rejects(loadInventory(fetchResult({error:"סכמת המלאי אינה מעודכנת"},503)),/סכמת המלאי/);
 await assert.rejects(loadInventory((async()=>new Response("<html>login</html>")) as typeof fetch),/תשובה שאינה תקינה/);
 await assert.rejects(loadInventory((async()=>{throw new Error("network unavailable");}) as typeof fetch),/network/);
});
