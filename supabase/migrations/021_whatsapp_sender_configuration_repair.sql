-- Completes the sender-management RPC contract on installations with an older 020.
-- No row deletion, role changes, or attendance/chat changes. Safe to apply repeatedly.
begin;
do $$
begin
  if to_regclass('public.whatsapp_attendance_senders') is null
    or to_regclass('public.whatsapp_attendance_audit') is null
    or to_regclass('public.whatsapp_attendance_inbox') is null
    or to_regclass('public.whatsapp_attendance_receipts') is null then
    raise exception 'WhatsApp attendance tables are missing; inspect migration 020 prerequisites before applying 021';
  end if;
end;
$$;

create or replace function public.configure_whatsapp_attendance_sender(p_actor uuid,p_phone text,p_user uuid,p_enabled boolean,p_auto boolean) returns void
language plpgsql security invoker set search_path='' set lock_timeout='3s' set statement_timeout='8s' as $$
begin
  perform id from public.profiles where id in (p_actor,p_user) order by id for share;
  if not exists(select 1 from public.profiles where id=p_actor and role='owner') then
    raise exception 'Owner permission required' using errcode='42501';
  end if;
  if not exists(select 1 from public.profiles where id=p_user and role in ('owner','manager')) then
    raise exception 'Sender account must be an existing owner or manager' using errcode='22023';
  end if;
  if p_phone is null or p_phone !~ '^[1-9][0-9]{7,14}$' or p_enabled is null or p_auto is null then
    raise exception 'Invalid sender configuration' using errcode='22023';
  end if;
  insert into public.whatsapp_attendance_senders(phone,user_id,enabled,auto_save,updated_by)
  values(p_phone,p_user,p_enabled,p_auto,p_actor)
  on conflict(phone) do update set user_id=excluded.user_id,enabled=excluded.enabled,
    auto_save=excluded.auto_save,updated_by=p_actor,updated_at=now();
  insert into public.whatsapp_attendance_audit(actor_id,action) values(p_actor,'sender_configuration_updated');
end;
$$;

create or replace function public.review_whatsapp_attendance(p_actor uuid,p_inbox uuid,p_action text) returns boolean
language plpgsql security invoker set search_path='' set lock_timeout='3s' set statement_timeout='8s' as $$
declare changed boolean;
begin
  perform id from public.profiles where id=p_actor for share;
  if not exists(select 1 from public.profiles where id=p_actor and role in ('owner','manager')) then
    raise exception 'Unauthorized' using errcode='42501';
  end if;
  if p_action='reject' then
    update public.whatsapp_attendance_inbox set status='rejected',reviewed_by=p_actor
      where id=p_inbox and status in ('review','failed','pending'); changed:=found;
  elsif p_action='retry' then
    update public.whatsapp_attendance_inbox set status='pending',attempts=0,error_code=null,available_at=now()
      where id=p_inbox and status='failed'; changed:=found;
  elsif p_action='retryReceipt' then
    update public.whatsapp_attendance_receipts set status='pending',attempts=0,error_code=null,available_at=now()
      where inbox_id=p_inbox and status in ('failed','expired')
      and exists(select 1 from public.whatsapp_attendance_inbox where id=p_inbox and status='approved'); changed:=found;
  else raise exception 'Invalid review action' using errcode='22023'; end if;
  if changed then
    insert into public.whatsapp_attendance_audit(actor_id,inbox_id,action) values(p_actor,p_inbox,p_action);
  end if;
  return changed;
end;
$$;

-- These are server-only invoker functions. Do not expose private sender tables to browsers.
alter table public.whatsapp_attendance_senders enable row level security;
alter table public.whatsapp_attendance_audit enable row level security;
revoke all on function public.configure_whatsapp_attendance_sender(uuid,text,uuid,boolean,boolean),
  public.review_whatsapp_attendance(uuid,uuid,text) from public,anon,authenticated;
grant usage on schema public to service_role;
grant select on public.profiles to service_role;
-- PostgreSQL requires UPDATE privilege on at least one column for SELECT ... FOR SHARE.
-- The functions only lock these rows; they never update profile data or roles.
grant update(id) on public.profiles to service_role;
grant select,insert,update on public.whatsapp_attendance_senders to service_role;
grant select,update on public.whatsapp_attendance_inbox,public.whatsapp_attendance_receipts to service_role;
grant insert on public.whatsapp_attendance_audit to service_role;
grant usage,select on sequence public.whatsapp_attendance_audit_id_seq to service_role;
grant execute on function public.configure_whatsapp_attendance_sender(uuid,text,uuid,boolean,boolean),
  public.review_whatsapp_attendance(uuid,uuid,text) to service_role;
notify pgrst,'reload schema';
commit;
