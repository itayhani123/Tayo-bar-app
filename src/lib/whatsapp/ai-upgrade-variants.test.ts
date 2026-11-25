import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {aiFixture} from './ai-db-fixture';

const signature="'public.receive_whatsapp_attendance(text,text,text,text,timestamptz)'::regprocedure";
const hash=(s:string)=>createHash('md5').update(s.replaceAll('\r','').replace(/^[ \t\n]+|[ \t\n]+$/g,'')).digest('hex');
const pairs={
 '020':['b68c2839dbf100c5da47bcca8a0c0be2','8946438f48517f966676373073bf617c'],
 production:['25e1b9ed098814007e3e35fc33b1724a','d65c10859435cebe0693f8071913700e']
};
for(const source of ['020','production'] as const){
 test(`034 ${source}: exact source/target, metadata, readonly checks and separate report/AI quotas`,async()=>{
  const f=await aiFixture(false,true,source);
  try{
   const before=(await f.pg.query<{row:Record<string,unknown>}>(`select to_jsonb(p) row from pg_proc p where oid=${signature}`)).rows[0].row;
   assert.equal(hash(before.prosrc as string),pairs[source][0]);
   if(source==='production'){
    const exact=readFileSync('src/lib/whatsapp/fixtures/receive-attendance-production.sql','utf8').match(/AS \$function\$([\s\S]*?)\$function\$/)![1];
    assert.ok(exact.includes('\r\n'));assert.equal(before.prosrc,exact);
   }
   await f.pg.exec('begin read only');
   const pre=await f.pg.query<{status:string}>(readFileSync('docs/sql/034-whatsapp-ai-preflight.sql','utf8'));
   assert.equal(pre.rows.filter(r=>r.status==='PASS').length,67);assert.equal(pre.rows.filter(r=>r.status==='FAIL').length,0);
   await f.pg.exec('rollback');await f.pg.exec(f.migration);
   const after=(await f.pg.query<{row:Record<string,unknown>}>(`select to_jsonb(p) row from pg_proc p where oid=${signature}`)).rows[0].row;
   assert.equal(hash(after.prosrc as string),pairs[source][1]);
   assert.equal(after.prosrc,(before.prosrc as string).replace('where phone=p_phone and received_at',"where report_type<>'ai_question' and phone=p_phone and received_at"));
   delete before.prosrc;delete after.prosrc;assert.deepEqual(after,before);
   await f.pg.exec('begin read only');
   const verified=await f.pg.query<{status:string}>(readFileSync('docs/sql/034-whatsapp-ai-verify.sql','utf8'));
   assert.equal(verified.rows.filter(r=>r.status==='PASS').length,27);assert.equal(verified.rows.filter(r=>r.status==='FAIL').length,0);
   await f.pg.exec('rollback');
   await assert.rejects(f.pg.exec(f.migration),/already installed/);await f.pg.exec('rollback');
   await f.allow(f.phone,f.owner);await f.allow(f.managerPhone,f.manager);await f.control(true);
   for(let i=0;i<31;i++)assert.equal(await f.receive(),true);
   const args=(id:string)=>({p_message_id:id,p_phone:f.phone,p_phone_id:f.phoneId,p_text:'Synthetic report',p_at:new Date().toISOString()});
   for(let i=0;i<30;i++)assert.equal(await f.rpc(i%2?'receive_inventory_whatsapp':'receive_whatsapp_attendance',args('report-'+i)),true);
   for(const rpc of ['receive_whatsapp_attendance','receive_inventory_whatsapp']){
    if(source==='production')assert.equal(await f.rpc(rpc,args('over-'+rpc)),false);
    else await assert.rejects(f.rpc(rpc,args('over-'+rpc)),/Sender rate limit/);
   }
   assert.equal(await f.rpc('receive_whatsapp_attendance',args('report-0')),true);
   assert.equal(await f.rpc('receive_inventory_whatsapp',args('report-1')),true);
   assert.equal((await f.pg.query<{n:number}>("select count(*)::int n from whatsapp_attendance_inbox where report_type<>'ai_question'")).rows[0].n,30);
   // AI limits do not depend on attendance/inventory quota and do not claim reports.
   await f.pg.exec("update whatsapp_attendance_inbox set status='rejected' where report_type<>'ai_question';update whatsapp_ai_tasks set status='expired'");
   const bucket='day:'+f.manager+':'+new Date().toISOString().slice(0,10).replaceAll('-','');
   await f.pg.query("insert into whatsapp_ai_usage values($1,40,now()+interval '1 day')",[bucket]);
   assert.equal(await f.receive(undefined,f.managerPhone),true);assert.equal(await f.claim(),null);
   assert.equal((await f.pg.query<{error_code:string}>("select error_code from whatsapp_ai_tasks where status='ready'")).rows[0].error_code,'QUOTA');
  }finally{await f.pg.close();}
 });
 test(`034 ${source}: unknown body, wrong target and late failure all roll back`,async()=>{
  const f=await aiFixture(false,true,source);
  try{
   const original=(await f.pg.query<{v:string}>(`select pg_get_functiondef(${signature}) v`)).rows[0].v;
   const baseline=(await f.pg.query<{v:string}>('select pg_get_constraintdef(oid) v from pg_constraint where conrelid=\'whatsapp_attendance_inbox\'::regclass order by oid')).rows;
   for(const failure of ['unknown','target','late'] as const){
    if(failure==='unknown')await f.pg.exec(original.replace('declare uid uuid;','declare uid uuid; -- UNKNOWN\n'));
    if(failure==='unknown'){
     await f.pg.exec('begin read only');
     const pre=await f.pg.query<{check_name:string;status:string}>(readFileSync('docs/sql/034-whatsapp-ai-preflight.sql','utf8'));
     assert.equal(pre.rows.find(r=>r.check_name.startsWith('public.receive_whatsapp_attendance('))?.status,'FAIL');
     await f.pg.exec('rollback');
    }
    const current=(await f.pg.query<{v:string}>(`select pg_get_functiondef(${signature}) v`)).rows[0].v;
    const migration=failure==='target'?f.migration.replace(pairs[source][1],'00000000000000000000000000000000'):
     failure==='late'?f.migration.replace(/commit;\s*$/i,()=>"do $$begin raise exception 'LATE_FAIL';end$$;commit;"):f.migration;
    await assert.rejects(f.pg.exec(migration),failure==='unknown'?/Unreviewed/:failure==='target'?/post-upgrade hash\/metadata mismatch/:/LATE_FAIL/);
    await f.pg.exec('rollback');
    assert.equal((await f.pg.query<{v:string}>(`select pg_get_functiondef(${signature}) v`)).rows[0].v,current);
    assert.equal((await f.pg.query<{v:string|null}>("select to_regclass('whatsapp_ai_tasks')::text v")).rows[0].v,null);
    assert.deepEqual((await f.pg.query<{v:string}>('select pg_get_constraintdef(oid) v from pg_constraint where conrelid=\'whatsapp_attendance_inbox\'::regclass order by oid')).rows,baseline);
    await f.pg.exec(original);
   }
  }finally{await f.pg.close();}
 });
}
