begin;
-- Keep the existing failure queue, lease guard, trigger and deduplication.
-- Inventory failures must never claim that a time report was processed.
create or replace function public.queue_whatsapp_attendance_failure(p_inbox uuid,p_lease uuid) returns boolean
language plpgsql security invoker set search_path='' as $$
declare q public.whatsapp_attendance_inbox; feedback text;
begin
 select * into q from public.whatsapp_attendance_inbox where id=p_inbox;
 if q.id is null or q.status<>'failed' or q.lease_token is distinct from p_lease then return false; end if;
 if q.report_type='inventory' then
  feedback:='לא ניתן לפענח או לבדוק את דיווח המלאי. לא נשמר שינוי במלאי ממסלול הפענוח. בדקו סוג פעולה, מוצרים וכמויות שלמות; לצריכה ציינו גם אולם ותאריך. שלחו דיווח חדש או פנו לבעלים לבדיקת המערכת.';
 else
  feedback:='דיווח '||q.id||E'\nלא ניתן לפענח או לבדוק את הדיווח לאחר ניסיונות חוזרים. לא נשמרו שעות ממסלול הפענוח. בדקו אולם, תאריך ושמות ושלחו שוב, או פתחו את הדיווח באפליקציה';
 end if;
 insert into public.whatsapp_attendance_receipts(inbox_id,phone,message_at,kind,dedupe_key,body)
 values(q.id,q.phone,q.message_at,'failure','failure:'||q.id||':'||p_lease,feedback) on conflict(dedupe_key) do nothing;
 return true;
end;$$;
revoke all on function public.queue_whatsapp_attendance_failure(uuid,uuid) from public,anon,authenticated;
grant execute on function public.queue_whatsapp_attendance_failure(uuid,uuid) to service_role;
notify pgrst,'reload schema';
commit;
