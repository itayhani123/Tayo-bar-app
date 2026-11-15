-- Server-stored, actor-bound proposals. Neither clients nor the model can execute these RPCs.
begin;
create table public.ai_action_proposals (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references auth.users(id),
  actor_role text not null check (actor_role in ('owner','manager')),
  request_key text not null,
  action text not null check (action in ('propose_create_event','propose_update_event','propose_assign_employee','propose_update_assignment','propose_remove_assignment','propose_record_payment','propose_update_payment','propose_close_venue')),
  target_id uuid not null,
  payload jsonb not null,
  expected jsonb not null,
  summary jsonb not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '10 minutes',
  status text not null default 'pending' check (status in ('pending','succeeded','cancelled','expired','stale','failed')),
  result jsonb,
  unique(actor_id, request_key)
);
create index ai_action_proposals_expiry_idx on public.ai_action_proposals(expires_at) where status='pending';
create table public.ai_action_audit (
  id bigint generated always as identity primary key,
  proposal_id uuid references public.ai_action_proposals(id),
  actor_id uuid not null references auth.users(id),
  action text not null,
  target_id uuid,
  outcome text not null,
  occurred_at timestamptz not null default now()
);
alter table public.ai_action_proposals enable row level security;
alter table public.ai_action_audit enable row level security;
revoke all on public.ai_action_proposals, public.ai_action_audit from public, anon, authenticated;
grant all on public.ai_action_proposals, public.ai_action_audit to service_role;
revoke update,delete,truncate,references,trigger on public.ai_action_audit from service_role;
grant usage, select on sequence public.ai_action_audit_id_seq to service_role;
grant select on public.ai_action_audit to authenticated;
create policy "Owners read AI action audit" on public.ai_action_audit for select to authenticated using (exists(select 1 from public.profiles where id=auth.uid() and role='owner'));

-- One statement snapshot includes dependent payments, staffing and catalog rows.
-- Full source rows remain server-side and are never included in model tool outputs.
create function public.ai_action_snapshot(p_action text, p_target uuid, p_payload jsonb) returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare eid uuid; current_event public.events; vid uuid; empid uuid;
begin
  if p_action='propose_close_venue' then return public.venue_settlement_snapshot(p_target); end if;
  eid := case when p_action in ('propose_create_event','propose_update_event') then p_target else (p_payload->>'event_id')::uuid end;
  select * into current_event from public.events where id=eid;
  vid := coalesce((p_payload->>'venue_id')::uuid, current_event.venue_id);
  empid := (p_payload->>'employee_id')::uuid;
  return jsonb_build_object(
    'event', case when current_event.id is null then null else to_jsonb(current_event) end,
    'assignments', coalesce((select jsonb_agg(to_jsonb(a) order by a.id) from public.event_assignments a where event_id=eid), '[]'::jsonb),
    'payments', coalesce((select jsonb_agg(to_jsonb(p) order by p.id) from public.event_payments p where event_id=eid), '[]'::jsonb),
    'venue', (select to_jsonb(v) from public.venues v where v.id=vid),
    'previousVenue', (select to_jsonb(v) from public.venues v where v.id=current_event.venue_id),
    'employee', (select to_jsonb(e) from public.employees e where e.id=empid),
    'eventType', (select to_jsonb(t) from public.event_types t where t.name=coalesce(p_payload->>'event_type',current_event.event_type)),
    'package', (select to_jsonb(t) from public.bar_packages t where t.name=coalesce(p_payload->>'package_type',current_event.package_type)),
    'paymentMethod', (select to_jsonb(t) from public.payment_methods t where t.name=p_payload->>'payment_method')
  );
end;
$$;
revoke all on function public.ai_action_snapshot(text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.ai_action_snapshot(text,uuid,jsonb) to service_role;

create function public.register_ai_action(p_actor uuid,p_role text,p_request_key text,p_action text,p_target uuid,p_payload jsonb,p_expected jsonb,p_summary jsonb) returns jsonb
language plpgsql security invoker set search_path = '' set statement_timeout = '8s' as $$
declare proposal public.ai_action_proposals;
begin
  if not exists(select 1 from public.profiles where id=p_actor and role=p_role and role in ('owner','manager')) then raise exception 'Unauthorized' using errcode='42501'; end if;
  if p_role <> 'owner' and p_action in ('propose_record_payment','propose_update_payment','propose_close_venue') then raise exception 'Unauthorized' using errcode='42501'; end if;
  -- Repeated chat delivery uses a server-derived request key and returns the same proposal.
  select * into proposal from public.ai_action_proposals where actor_id=p_actor and request_key=p_request_key;
  if proposal.id is null then
    -- Bound unconfirmed proposal storage/cost without preventing cancellation or result recovery.
    if (select count(*) from public.ai_action_proposals where actor_id=p_actor and status='pending' and expires_at>now()) >= 20 then raise exception 'Too many pending proposals'; end if;
    insert into public.ai_action_proposals(actor_id,actor_role,request_key,action,target_id,payload,expected,summary)
      values(p_actor,p_role,p_request_key,p_action,p_target,p_payload,p_expected,p_summary)
      on conflict(actor_id,request_key) do nothing returning * into proposal;
    if proposal.id is null then select * into proposal from public.ai_action_proposals where actor_id=p_actor and request_key=p_request_key;
    else insert into public.ai_action_audit(proposal_id,actor_id,action,target_id,outcome) values(proposal.id,p_actor,p_action,p_target,'proposed'); end if;
  end if;
  if proposal.actor_role <> p_role or proposal.status <> 'pending' or proposal.expires_at <= now() then raise exception 'Proposal no longer pending'; end if;
  return proposal.summary || jsonb_build_object('id',proposal.id,'expiresAt',proposal.expires_at);
end;
$$;
revoke all on function public.register_ai_action(uuid,text,text,text,uuid,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.register_ai_action(uuid,text,text,text,uuid,jsonb,jsonb,jsonb) to service_role;

create function public.decide_ai_action(p_actor uuid,p_proposal uuid,p_decision text) returns jsonb
language plpgsql security invoker set search_path = '' set lock_timeout = '5s' set statement_timeout = '15s' as $$
declare
  proposal public.ai_action_proposals; actor_role text; current_snapshot jsonb;
  e public.events; a public.event_assignments; payment public.event_payments;
  payload jsonb; allowed text[]; v_event_id uuid; result_id uuid; outcome text; response jsonb;
begin
  if p_decision not in ('confirm','cancel') then raise exception 'Invalid decision'; end if;
  select role into actor_role from public.profiles where id=p_actor for share;
  select * into proposal from public.ai_action_proposals where id=p_proposal for update;
  if proposal.id is null or proposal.actor_id <> p_actor then
    insert into public.ai_action_audit(actor_id,action,outcome) values(p_actor,'confirmation','forbidden');
    return jsonb_build_object('status','forbidden');
  end if;
  if actor_role is null or actor_role <> proposal.actor_role or (actor_role <> 'owner' and proposal.action in ('propose_record_payment','propose_update_payment','propose_close_venue')) then
    insert into public.ai_action_audit(proposal_id,actor_id,action,target_id,outcome) values(proposal.id,p_actor,proposal.action,proposal.target_id,'forbidden');
    return jsonb_build_object('status','forbidden');
  end if;
  if proposal.status <> 'pending' then return proposal.result || jsonb_build_object('status',proposal.status,'replayed',true); end if;
  if p_decision='cancel' then outcome := 'cancelled';
  elsif proposal.expires_at <= now() then outcome := 'expired';
  else
    begin
      -- Same ordering as close_venue_settlement. Locks also exclude normal UI inserts/updates
      -- while expected state is checked and written; source tables are never bulk modified.
      lock table public.venues, public.events, public.event_payments, public.venue_settlements, public.event_assignments, public.employees, public.event_types, public.bar_packages, public.payment_methods in share row exclusive mode;
      payload := proposal.payload;
      current_snapshot := public.ai_action_snapshot(proposal.action,proposal.target_id,payload);
      if current_snapshot is distinct from proposal.expected then outcome := 'stale';
      else
        v_event_id := case when proposal.action in ('propose_create_event','propose_update_event') then proposal.target_id else (payload->>'event_id')::uuid end;
        if proposal.action in ('propose_create_event','propose_update_event') then
          allowed := array['event_date','start_time','event_type','venue_id','client_name','client_phone','guest_count','package_type','manager_employee_id','notes'];
          if actor_role='owner' or proposal.action='propose_create_event' then allowed := allowed || array['price_per_guest','vat_rate','price_includes_vat','payer_type','payment_status','security_check_received','invoice_issued','estimated_alcohol_cost']; end if;
          if exists(select 1 from jsonb_object_keys(payload) k where not(k=any(allowed))) then raise exception 'Forbidden event field'; end if;
          if actor_role='manager' and proposal.action='propose_create_event' and not(payload @> '{"price_per_guest":0,"vat_rate":18,"price_includes_vat":true,"payer_type":"client","payment_status":"unpaid","security_check_received":false,"invoice_issued":false,"estimated_alcohol_cost":0}'::jsonb) then raise exception 'Forbidden financial defaults'; end if;
          if proposal.action='propose_create_event' then e := jsonb_populate_record(null::public.events,payload);
          else select * into strict e from public.events where id=v_event_id; e := jsonb_populate_record(e,payload); end if;
          if e.guest_count < 1 or e.event_date is null or e.start_time is null or length(trim(e.client_name))=0 or current_snapshot->'venue'='null'::jsonb or current_snapshot->'eventType'='null'::jsonb or current_snapshot->'package'='null'::jsonb then raise exception 'Invalid event'; end if;
          if proposal.action='propose_create_event' then
            insert into public.events(id,event_date,start_time,event_type,venue_id,client_name,client_phone,guest_count,price_per_guest,vat_rate,price_includes_vat,package_type,payer_type,payment_status,security_check_received,invoice_issued,estimated_alcohol_cost,manager_employee_id,notes,sales_status)
            values(proposal.target_id,e.event_date,e.start_time,e.event_type,e.venue_id,e.client_name,e.client_phone,e.guest_count,e.price_per_guest,e.vat_rate,e.price_includes_vat,e.package_type,e.payer_type,e.payment_status,e.security_check_received,e.invoice_issued,e.estimated_alcohol_cost,e.manager_employee_id,e.notes,'lead');
          else
            update public.events set event_date=e.event_date,start_time=e.start_time,event_type=e.event_type,venue_id=e.venue_id,client_name=e.client_name,client_phone=e.client_phone,guest_count=e.guest_count,price_per_guest=e.price_per_guest,vat_rate=e.vat_rate,price_includes_vat=e.price_includes_vat,package_type=e.package_type,payer_type=e.payer_type,payment_status=e.payment_status,security_check_received=e.security_check_received,invoice_issued=e.invoice_issued,estimated_alcohol_cost=e.estimated_alcohol_cost,manager_employee_id=e.manager_employee_id,notes=e.notes where id=v_event_id;
          end if;
          result_id := v_event_id;
        elsif proposal.action in ('propose_assign_employee','propose_update_assignment','propose_remove_assignment') then
          if proposal.action='propose_assign_employee' then a := jsonb_populate_record(null::public.event_assignments,payload);
          else select * into strict a from public.event_assignments where id=proposal.target_id and event_id=v_event_id; end if;
          if proposal.action='propose_remove_assignment' then delete from public.event_assignments where id=proposal.target_id;
          else
            if exists(select 1 from jsonb_object_keys(payload) k where not(k=any(array['event_id','employee_id','event_role','role','is_manager','pay_type','hourly_rate','fixed_pay','work_start','work_end','notes']))) then raise exception 'Forbidden assignment field'; end if;
            if actor_role='manager' and proposal.action='propose_update_assignment' and (payload ?| array['pay_type','hourly_rate','fixed_pay']) then raise exception 'Forbidden payroll field'; end if;
            a := jsonb_populate_record(a,payload);
            if not exists(select 1 from public.employees where id=a.employee_id and active) then raise exception 'Inactive employee'; end if;
            if actor_role='manager' and proposal.action='propose_assign_employee' and (a.pay_type<>'hourly' or a.fixed_pay is not null or a.hourly_rate is distinct from (select default_hourly_rate from public.employees where id=a.employee_id)) then raise exception 'Forbidden payroll field'; end if;
            if exists(select 1 from public.event_assignments x where x.event_id=a.event_id and x.employee_id=a.employee_id and x.id<>proposal.target_id) then raise exception 'Employee already assigned'; end if;
            if proposal.action='propose_assign_employee' then insert into public.event_assignments(id,event_id,employee_id,event_role,role,is_manager,pay_type,hourly_rate,fixed_pay,work_start,work_end,notes) values(proposal.target_id,a.event_id,a.employee_id,a.event_role,a.role,a.is_manager,a.pay_type,a.hourly_rate,a.fixed_pay,a.work_start,a.work_end,a.notes);
            else update public.event_assignments set event_role=a.event_role,role=a.role,is_manager=a.is_manager,pay_type=a.pay_type,hourly_rate=a.hourly_rate,fixed_pay=a.fixed_pay,work_start=a.work_start,work_end=a.work_end,notes=a.notes where id=proposal.target_id; end if;
          end if;
          result_id := proposal.target_id;
        elsif proposal.action in ('propose_record_payment','propose_update_payment') then
          if exists(select 1 from jsonb_object_keys(payload) k where not(k=any(array['event_id','amount','payment_method','payer_type','paid_at','notes']))) then raise exception 'Forbidden payment field'; end if;
          payment := jsonb_populate_record(null::public.event_payments,payload);
          if payment.amount<=0 or payment.amount is null or payment.paid_at is null or not exists(select 1 from public.payment_methods where name=payment.payment_method) then raise exception 'Invalid payment'; end if;
          if proposal.action='propose_record_payment' then insert into public.event_payments(id,event_id,amount,payment_method,payer_type,paid_at,notes) values(proposal.target_id,payment.event_id,payment.amount,payment.payment_method,payment.payer_type,payment.paid_at,payment.notes);
          else
            update public.event_payments set amount=payment.amount,payment_method=payment.payment_method,payer_type=payment.payer_type,paid_at=payment.paid_at,notes=payment.notes where id=proposal.target_id and public.event_payments.event_id=payment.event_id;
            if not found then raise exception 'Payment not found'; end if;
          end if;
          result_id := proposal.target_id;
        elsif proposal.action='propose_close_venue' then
          result_id := public.close_venue_settlement(proposal.target_id,(payload->>'cutoff_date')::date,(payload->>'amount')::numeric,p_actor,proposal.id,proposal.expected,(payload->>'includes_hall_fee')::boolean,payload->'allocations');
        else raise exception 'Unsupported action'; end if;
        outcome := 'succeeded';
      end if;
    exception when others then outcome := 'failed';
    end;
  end if;
  response := jsonb_build_object('status',outcome,'eventId',v_event_id,'targetId',result_id,'href',case when proposal.action='propose_close_venue' then '/receivables' when v_event_id is not null then '/events?event='||v_event_id::text else null end);
  update public.ai_action_proposals set status=outcome,result=response where id=proposal.id;
  insert into public.ai_action_audit(proposal_id,actor_id,action,target_id,outcome) values(proposal.id,p_actor,proposal.action,proposal.target_id,outcome);
  return response || jsonb_build_object('replayed',false);
end;
$$;
revoke all on function public.decide_ai_action(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.decide_ai_action(uuid,uuid,text) to service_role;
commit;
