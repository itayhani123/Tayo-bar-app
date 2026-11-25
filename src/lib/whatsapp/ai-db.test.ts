import test from 'node:test';
import assert from 'node:assert/strict';
import {aiFixture} from './ai-db-fixture';
import {createWhatsAppAiReader} from './ai-reader';
import {readFileSync} from 'node:fs';
for(const source of ['020','production'] as const)test(`034 SQL (${source}): protected installation, priority, real role boundaries, pending reports, dedup and delivery`,async t=>{
 const f=await aiFixture(true,true,source);const{pg,rpc,owner,manager,phone,managerPhone,phoneId,receive,claim,db}=f;
 const args={start:'2026-01-01',end:'2026-01-02',venueId:null};
 try{
  await t.test('AI messages share provider dedup but cannot enter legacy report claims',async()=>{
   const message=crypto.randomUUID();assert.equal(await receive(undefined,phone,message),true);assert.equal(await receive(undefined,phone,message),true);
   assert.equal((await pg.query<{n:number}>('select count(*)::int n from whatsapp_ai_tasks')).rows[0].n,1);
   assert.equal(await rpc('claim_whatsapp_attendance',{p_receipt:false}),null);
   assert.equal(await rpc('receive_whatsapp_attendance',{p_message_id:message,p_phone:phone,p_phone_id:phoneId,p_text:'attendance',p_at:new Date().toISOString()}),true);
   assert.equal((await pg.query<{n:number}>('select count(*)::int n from whatsapp_attendance_inbox')).rows[0].n,1);
  });
  await t.test('real SQL snapshot plus existing calculations; manager cannot fetch financial fields',async()=>{
   const job=(await claim())!;assert.ok(job);assert.equal(await claim(),null);
   const snapshot=await rpc('read_whatsapp_ai_snapshot',{p_id:job.id,p_lease:job.lease_token,p_phone_id:phoneId,p_tool:'operations',p_args:args});
   assert.doesNotMatch(JSON.stringify(snapshot),/pricePerGuest|fixedPay|PRIVATE_PHONE|INJECTED/);
   const reader=createWhatsAppAiReader(db,job,phoneId);
   const result=await reader.read('owner','financial_summary',args,new AbortController().signal);
   assert.match(JSON.stringify(result),/estimatedProfit/);
   await assert.rejects(rpc('read_whatsapp_ai_snapshot',{p_id:job.id,p_lease:job.lease_token,p_phone_id:'OTHER_BUSINESS',p_tool:'operations',p_args:args}),/FORBIDDEN/);
   await assert.rejects(rpc('read_whatsapp_ai_snapshot',{p_id:job.id,p_lease:crypto.randomUUID(),p_phone_id:phoneId,p_tool:'operations',p_args:args}),/FORBIDDEN/);
   await pg.query("update profiles set role='manager' where id=$1",[owner]);
   await assert.rejects(rpc('read_whatsapp_ai_snapshot',{p_id:job.id,p_lease:job.lease_token,p_phone_id:phoneId,p_tool:'financial_summary',p_args:args}),/FORBIDDEN/);
   await pg.query("update profiles set role='owner' where id=$1",[owner]);
   assert.equal(await rpc('complete_whatsapp_ai',{p_id:job.id,p_lease:job.lease_token,p_phone_id:phoneId,p_answer:'Answer'}),true);
   const send=(await claim(true))!;assert.ok(send);
   assert.equal(await rpc('claim_whatsapp_attendance',{p_receipt:true}),null);
   assert.equal(await rpc('ack_whatsapp_ai',{p_id:send.id,p_lease:send.lease_token,p_phone_id:phoneId,p_provider:'test-provider'}),true);
   assert.equal(await rpc('ack_whatsapp_ai',{p_id:send.id,p_lease:send.lease_token,p_phone_id:phoneId,p_provider:'test-provider'}),false);
  });
  await t.test('manager RPC denies finance even when bypassing the TypeScript adapter',async()=>{
   await receive(undefined,managerPhone);const job=(await claim())!;assert.equal(job.role,'manager');
   for(const tool of ['financial_summary','receivables','venue_closings','propose_create_event'])await assert.rejects(rpc('read_whatsapp_ai_snapshot',{p_id:job.id,p_lease:job.lease_token,p_phone_id:phoneId,p_tool:tool,p_args:args}),/FORBIDDEN/);
   await pg.query("update whatsapp_ai_tasks set status='expired' where inbox_id=$1",[job.id]);
  });
  await t.test('pending confirmation is unchanged and new report work preempts AI',async()=>{
   await rpc('receive_whatsapp_attendance',{p_message_id:crypto.randomUUID(),p_phone:phone,p_phone_id:phoneId,p_text:'report',p_at:new Date().toISOString()});
   const report=await rpc('claim_whatsapp_attendance',{p_receipt:false}) as {id:string};
   const preview={eventSelection:{state:'awaiting',token:crypto.randomUUID()}};
   await pg.query("update whatsapp_attendance_inbox set status='review',preview=$2,confirmation_token=gen_random_uuid(),confirmation_expires_at=now()+interval '10 minutes' where id=$1",[report.id,JSON.stringify(preview)]);
   const before=await pg.query('select * from whatsapp_attendance_inbox where id=$1',[report.id]);
   await receive();const job=(await claim())!;assert.ok(job);
   await rpc('receive_whatsapp_attendance',{p_message_id:crypto.randomUUID(),p_phone:phone,p_phone_id:phoneId,p_text:'urgent report',p_at:new Date().toISOString()});
   await assert.rejects(rpc('read_whatsapp_ai_snapshot',{p_id:job.id,p_lease:job.lease_token,p_phone_id:phoneId,p_tool:'operations',p_args:args}),/REPORT_PRIORITY/);
   assert.equal(await rpc('complete_whatsapp_ai',{p_id:job.id,p_lease:job.lease_token,p_phone_id:phoneId,p_answer:'No send'}),false);
   assert.equal(await claim(),null);
   assert.deepEqual(await pg.query('select * from whatsapp_attendance_inbox where id=$1',[report.id]),before);
   await pg.exec("update whatsapp_attendance_inbox set status='rejected' where report_type='attendance' and status='pending'; update whatsapp_ai_tasks set status='expired' where status='pending'");
  });
  await t.test('quota is durable; AI intake never spends the 30-report allowance',async()=>{
   const bucket='day:'+manager+':'+new Date().toISOString().slice(0,10).replaceAll('-','');
   await pg.query("insert into whatsapp_ai_usage values($1,40,now()+interval '1 day') on conflict(bucket) do update set requests=40",[bucket]);
   await receive(undefined,managerPhone);assert.equal(await claim(),null);
   const row=(await pg.query<{error_code:string}>("select error_code from whatsapp_ai_tasks where status='ready'")).rows[0];assert.equal(row.error_code,'QUOTA');
   await pg.exec("update whatsapp_ai_tasks set status='expired' where status='ready'");
   for(let i=0;i<31;i++)await receive(undefined,phone);
   assert.equal(await rpc('receive_whatsapp_attendance',{p_message_id:crypto.randomUUID(),p_phone:phone,p_phone_id:phoneId,p_text:'report after AI flood',p_at:new Date().toISOString()}),true);
   await pg.exec("update whatsapp_attendance_inbox set status='rejected' where report_type='attendance' and status='pending';update whatsapp_ai_tasks set status='expired' where status='pending'");
  });
  await t.test('unknown external delivery is terminal, never automatically resent',async()=>{
   await receive();const job=(await claim())!;
   await rpc('complete_whatsapp_ai',{p_id:job.id,p_lease:job.lease_token,p_phone_id:phoneId,p_answer:'Ready'});
   const send=(await claim(true))!;
   await rpc('fail_whatsapp_ai_delivery',{p_id:send.id,p_lease:send.lease_token});
   assert.equal(await claim(true),null);
   assert.equal((await pg.query<{status:string}>('select status from whatsapp_ai_tasks where inbox_id=$1',[send.id])).rows[0].status,'delivery_unknown');
  });
  await t.test('browser roles cannot invoke read RPC or inspect tasks; reads run with enforced READ ONLY',async()=>{
   await pg.exec('set role authenticated');
   await assert.rejects(rpc('read_whatsapp_ai_snapshot',{p_id:crypto.randomUUID(),p_lease:crypto.randomUUID(),p_phone_id:phoneId,p_tool:'operations',p_args:args}),/permission denied/);
   await assert.rejects(pg.query('select * from whatsapp_ai_tasks'),/permission denied/);
   await pg.exec('reset role');
   await receive();const job=(await claim())!;
   await pg.exec('begin read only');
   await rpc('read_whatsapp_ai_snapshot',{p_id:job.id,p_lease:job.lease_token,p_phone_id:phoneId,p_tool:'operations',p_args:args});
   await pg.exec('rollback');
   assert.equal((await pg.query<{n:number}>('select count(*)::int n from events')).rows[0].n,1);
   assert.equal((await pg.query<{n:number}>('select count(*)::int n from inventory_movements')).rows[0].n,0);
   assert.equal((await pg.query<{n:number}>('select count(*)::int n from event_assignments')).rows[0].n,1);
  });
  await t.test('inventory v1 receipt/consumption keep explicit buttons, cancellation, stock guard and replay protection AFTER 034',async()=>{
   await rpc('inventory_set_receipt_permission',{p_actor:owner,p_phone:phone,p_enabled:true});
   const product=await rpc('inventory_save_product',{p_actor:owner,p_id:null,p_values:{name:'מוצר בדיקה',category:'וודקה',bottle_ml:1000,cost_agorot:'12500',minimum_qty:0,active:true,aliases:[]}});
   async function report(kind:string,decision:string,quantity:number){
    await rpc('receive_inventory_whatsapp',{p_message_id:crypto.randomUUID(),p_phone:phone,p_phone_id:phoneId,p_text:'test report',p_at:new Date().toISOString()});
    const q=await rpc('claim_whatsapp_attendance',{p_receipt:false}) as {id:string;lease_token:string};
    const stock=(await pg.query<{stock_qty:number}>('select stock_qty from inventory_products where id=$1',[product])).rows[0].stock_qty;
    await rpc('prepare_inventory_whatsapp',{p_actor:owner,p_inbox:q.id,p_lease:q.lease_token,p_kind:kind,p_event:kind==='consumption'?f.event:null,p_lines:[{product_id:product,quantity}],p_summary:'Test'});
    assert.equal((await pg.query<{stock_qty:number}>('select stock_qty from inventory_products where id=$1',[product])).rows[0].stock_qty,stock);
    const receipt=(await pg.query<{id:string;message_payload:{policy:string}}> ("select id,message_payload from whatsapp_attendance_receipts where inbox_id=$1 and kind='summary'",[q.id])).rows[0];
    assert.equal(receipt.message_payload.policy,'inventory_bottles_v1');const lease=crypto.randomUUID();
    await pg.query("update whatsapp_attendance_receipts set status='processing',lease_token=$2,lease_until=now()+interval '2 minutes' where id=$1",[receipt.id,lease]);
    assert.equal(await rpc('ack_whatsapp_attendance_receipt',{p_receipt:receipt.id,p_lease:lease,p_provider:'summary-'+q.id,p_final:true,p_next_index:1}),true);
    const token=(await pg.query<{confirmation_token:string}>('select confirmation_token from whatsapp_attendance_inbox where id=$1',[q.id])).rows[0].confirmation_token;
    await rpc('receive_whatsapp_attendance_button',{p_message_id:crypto.randomUUID(),p_phone:phone,p_phone_id:phoneId,p_inbox:q.id,p_token:token,p_decision:decision,p_at:new Date().toISOString(),p_reply_to:'summary-'+q.id});
    const d=await rpc('claim_whatsapp_attendance_decision') as {id:string;lease_token:string};
    const result=await rpc('execute_whatsapp_attendance_decision',{p_id:d.id,p_lease:d.lease_token});
    assert.deepEqual(await rpc('execute_whatsapp_attendance_decision',{p_id:d.id,p_lease:d.lease_token}),result);
    const after=(await pg.query<{stock_qty:number}>('select stock_qty from inventory_products where id=$1',[product])).rows[0].stock_qty;
    assert.equal(after,stock+(decision==='cancel'?0:kind==='receipt'?quantity:-quantity));
   }
   await report('receipt','cancel',3);await report('receipt','confirm',3);await report('consumption','confirm',1);
   await assert.rejects(rpc('inventory_prepare',{p_actor:owner,p_kind:'consumption',p_event:f.event,p_lines:[{product_id:product,quantity:100}],p_key:crypto.randomUUID(),p_reason:null,p_inbox:null}),/INSUFFICIENT/);
  });
  await t.test('revoked sender/changed role and expired service window cannot receive stored answers',async()=>{
   await pg.exec("update whatsapp_ai_tasks set status='expired' where status in ('pending','processing','ready');update whatsapp_attendance_receipts set status='sent' where kind<>'ai_answer' and status='pending';delete from whatsapp_ai_usage");
   await receive();const job=(await claim())!;
   await rpc('complete_whatsapp_ai',{p_id:job.id,p_lease:job.lease_token,p_phone_id:phoneId,p_answer:'Owner-only answer'});
   await pg.query("update profiles set role='manager' where id=$1",[owner]);assert.equal(await claim(true),null);
   await pg.query("update profiles set role='owner' where id=$1",[owner]);
   await receive();const next=(await claim())!;
   await rpc('complete_whatsapp_ai',{p_id:next.id,p_lease:next.lease_token,p_phone_id:phoneId,p_answer:'Stored'});
   await pg.query('update whatsapp_attendance_senders set enabled=false where phone=$1',[phone]);assert.equal(await claim(true),null);
   assert.equal(await receive(),false);
   await pg.query('update whatsapp_attendance_senders set enabled=true where phone=$1',[phone]);
   await receive();await pg.exec("update whatsapp_attendance_inbox set message_at=now()-interval '2 days' where report_type='ai_question' and id in (select inbox_id from whatsapp_ai_tasks where status='pending')");
   assert.equal(await claim(),null);
  });
 }finally{await pg.close();}
});

test('034 rejects unknown legacy definitions and rolls back its entire installation',async()=>{
 const f=await aiFixture(false);
 try{
  await f.pg.exec('begin read only');const preflight=await f.pg.query<{status:string}>(readFileSync('docs/sql/034-whatsapp-ai-preflight.sql','utf8'));assert.ok(preflight.rows.every(r=>r.status!=='FAIL'));await f.pg.exec('rollback');
  const original=(await f.pg.query<{v:string}>("select pg_get_functiondef('public.claim_whatsapp_attendance(boolean)'::regprocedure) v")).rows[0].v;
  await f.pg.exec(original.replace('declare result jsonb;','declare result jsonb; -- unreviewed\n'));
  await assert.rejects(f.pg.exec(f.migration),/Unreviewed 034/);await f.pg.exec('rollback');
  assert.equal((await f.pg.query<{v:string|null}>("select to_regclass('whatsapp_ai_tasks')::text v")).rows[0].v,null);
  await f.pg.exec(original);
  await f.pg.exec('create function public.read_whatsapp_ai_snapshot(integer) returns integer language sql as $$select $1$$');
  await assert.rejects(f.pg.exec(f.migration),/Preexisting 034 objects\/overloads/);await f.pg.exec('rollback');
  await f.pg.exec('drop function public.read_whatsapp_ai_snapshot(integer)');
  const fail=f.migration.replace(/commit;\s*$/i,()=>"do $$begin raise exception 'TEST_FAIL';end$$;commit;");
  await assert.rejects(f.pg.exec(fail),/TEST_FAIL/);await f.pg.exec('rollback');
  assert.equal((await f.pg.query<{v:string|null}>("select to_regclass('whatsapp_ai_tasks')::text v")).rows[0].v,null);
  assert.equal((await f.pg.query<{v:string}>("select pg_get_functiondef('public.claim_whatsapp_attendance(boolean)'::regprocedure) v")).rows[0].v,original);
  await f.pg.exec('grant service_role to authenticated');
  await assert.rejects(f.pg.exec(f.migration),/Unreviewed 034 prerequisite|Unsafe 034 function privileges/);await f.pg.exec('rollback');
  assert.equal((await f.pg.query<{v:string|null}>("select to_regclass('whatsapp_ai_tasks')::text v")).rows[0].v,null);
  await f.pg.exec('revoke service_role from authenticated');
 }finally{await f.pg.close();}
});
