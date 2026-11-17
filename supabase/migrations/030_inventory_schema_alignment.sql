begin;
-- Repair the earlier deployed variant of 027 without recreating tables,
-- dropping history, backfilling invented prices or resetting stock balances.
-- Apply after 028 and 029. On a fresh database 027 already has these columns.
-- Pending legacy previews lack product/event snapshots and must be prepared again;
-- the refreshed confirmation function refuses them rather than guessing.
alter table public.inventory_reports add column if not exists preview_costs jsonb not null default '[]';
alter table public.inventory_reports add column if not exists event_snapshot jsonb;

create or replace function public.inventory_role(p_actor uuid,p_owner boolean default false) returns text
language plpgsql security invoker set search_path='' as $$
declare r text;begin
 select role into r from public.profiles where id=p_actor for share;
 if r is null or r not in ('owner','manager') or (p_owner and r<>'owner') then raise exception 'INVENTORY_FORBIDDEN' using errcode='42501';end if;return r;
end;$$;
create or replace function public.inventory_balance_guard() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if (tg_op='INSERT' and new.stock_qty<>0) or (tg_op='UPDATE' and new.stock_qty<>old.stock_qty and pg_trigger_depth()<2) then raise exception 'INVENTORY_LEDGER_REQUIRED' using errcode='42501';end if;
 return new;
end;$$;
drop trigger if exists inventory_balance_guard on public.inventory_products;
create trigger inventory_balance_guard before insert or update on public.inventory_products for each row execute function public.inventory_balance_guard();
create or replace function public.inventory_immutable() returns trigger language plpgsql security invoker set search_path='' as $$begin raise exception 'INVENTORY_HISTORY_IMMUTABLE' using errcode='42501';end;$$;
drop trigger if exists inventory_movements_immutable on public.inventory_movements;
create trigger inventory_movements_immutable before update or delete on public.inventory_movements for each row execute function public.inventory_immutable();
drop trigger if exists inventory_audit_immutable on public.inventory_product_audit;
create trigger inventory_audit_immutable before update or delete on public.inventory_product_audit for each row execute function public.inventory_immutable();
create or replace function public.inventory_apply_movement() returns trigger language plpgsql security invoker set search_path='' as $$
declare p public.inventory_products;begin
 update public.inventory_products set stock_qty=stock_qty+new.quantity_delta,updated_at=now() where id=new.product_id returning * into p;
 if p.stock_qty<p.minimum_qty and to_regclass('public.app_notifications') is not null then
  insert into public.app_notifications(role_target,notification_type,title,message,severity,entity_type,entity_id,action_url,dedupe_key)
   values('owner','inventory_low','מלאי אלכוהול נמוך',p.name||': '||p.stock_qty||' בקבוקים','warning','inventory',p.id,'/inventory','inventory-low:'||p.id||':'||current_date) on conflict do nothing;
 end if;return new;
end;$$;
drop trigger if exists inventory_apply_movement on public.inventory_movements;
create trigger inventory_apply_movement after insert on public.inventory_movements for each row execute function public.inventory_apply_movement();

create or replace function public.inventory_save_product(p_actor uuid,p_id uuid,p_values jsonb) returns uuid
language plpgsql security invoker set search_path='' as $$
declare old_value jsonb;p public.inventory_products;begin
 perform public.inventory_role(p_actor,true);
 if jsonb_typeof(p_values)<>'object' or exists(select 1 from jsonb_object_keys(p_values) k where k not in ('name','category','bottle_ml','cost_agorot','minimum_qty','active','aliases'))
 or coalesce(p_values->>'cost_agorot','') !~ '^\d+$' or jsonb_typeof(p_values->'aliases')<>'array' or jsonb_array_length(p_values->'aliases')>30 then raise exception 'INVENTORY_INVALID_PRODUCT' using errcode='22023';end if;
 if p_id is not null then select to_jsonb(x) into old_value from public.inventory_products x where id=p_id for update;if old_value is null then raise exception 'INVENTORY_PRODUCT_NOT_FOUND';end if;end if;
 if p_id is null then
  insert into public.inventory_products(name,category,bottle_ml,cost_agorot,minimum_qty,active,aliases) values(trim(p_values->>'name'),p_values->>'category',(p_values->>'bottle_ml')::int,(p_values->>'cost_agorot')::bigint,(p_values->>'minimum_qty')::int,(p_values->>'active')::boolean,array(select jsonb_array_elements_text(p_values->'aliases'))) returning * into p;
 else
  update public.inventory_products set name=trim(p_values->>'name'),category=p_values->>'category',bottle_ml=(p_values->>'bottle_ml')::int,cost_agorot=(p_values->>'cost_agorot')::bigint,minimum_qty=(p_values->>'minimum_qty')::int,active=(p_values->>'active')::boolean,aliases=array(select jsonb_array_elements_text(p_values->'aliases')),updated_at=now() where id=p_id returning * into p;
 end if;
 insert into public.inventory_product_audit(product_id,actor_id,before_values,after_values) values(p.id,p_actor,old_value,to_jsonb(p));return p.id;
end;$$;
create or replace function public.inventory_set_receipt_permission(p_actor uuid,p_phone text,p_enabled boolean) returns void
language plpgsql security invoker set search_path='' as $$
declare uid uuid;begin
 perform public.inventory_role(p_actor,true);select user_id into uid from public.whatsapp_attendance_senders where phone=p_phone and enabled for share;
 if uid is null then raise exception 'INVENTORY_SENDER_NOT_FOUND';end if;
 insert into public.inventory_sender_permissions(phone,user_id,can_receive,changed_by) values(p_phone,uid,p_enabled,p_actor)
 on conflict(phone) do update set user_id=excluded.user_id,can_receive=excluded.can_receive,changed_by=p_actor,changed_at=now();
end;$$;

create or replace function public.inventory_prepare(p_actor uuid,p_kind text,p_event uuid,p_lines jsonb,p_key uuid,p_reason text default null,p_inbox uuid default null) returns uuid
language plpgsql security invoker set search_path='' as $$
declare r public.inventory_reports;x jsonb;p public.inventory_products;role_name text;q public.whatsapp_attendance_inbox;costs jsonb:='[]';snap jsonb;begin
 role_name:=public.inventory_role(p_actor);
 if p_kind not in ('consumption','receipt','adjustment') then raise exception 'INVENTORY_INVALID_KIND';end if;
 if p_inbox is null and p_kind<>'consumption' and role_name<>'owner' then raise exception 'INVENTORY_FORBIDDEN' using errcode='42501';end if;
 if p_kind='adjustment' and (role_name<>'owner' or length(trim(coalesce(p_reason,'')))<2) then raise exception 'INVENTORY_REASON_REQUIRED';end if;
 if p_inbox is not null then
  select * into q from public.whatsapp_attendance_inbox where id=p_inbox for update;
  if q.actor_id is distinct from p_actor or q.report_type<>'inventory' or q.status<>'processing' or p_kind='adjustment' then raise exception 'INVENTORY_FORBIDDEN' using errcode='42501';end if;
  if p_kind='receipt' and not exists(select 1 from public.inventory_sender_permissions where phone=q.phone and user_id=p_actor and can_receive) then raise exception 'INVENTORY_RECEIPT_PERMISSION' using errcode='42501';end if;
 end if;
 if (p_kind='consumption' and not exists(select 1 from public.events where id=p_event)) or (p_kind<>'consumption' and p_event is not null) then raise exception 'INVENTORY_EVENT_NOT_FOUND';end if;
 if p_kind='consumption' then select jsonb_build_object('id',e.id,'event_date',e.event_date,'venue_id',e.venue_id,'client_name',e.client_name) into snap from public.events e where id=p_event;end if;
 if jsonb_typeof(p_lines)<>'array' or jsonb_array_length(p_lines) not between 1 and 100 then raise exception 'INVENTORY_INVALID_LINES';end if;
 if (select count(distinct value->>'product_id') from jsonb_array_elements(p_lines))<>jsonb_array_length(p_lines) then raise exception 'INVENTORY_DUPLICATE_PRODUCT';end if;
 for x in select value from jsonb_array_elements(p_lines) loop
  if exists(select 1 from jsonb_object_keys(x) k where k not in ('product_id','quantity')) or coalesce(x->>'quantity','') !~ '^-?\d+$' or abs((x->>'quantity')::int) not between 1 and 100000 or (p_kind<>'adjustment' and (x->>'quantity')::int<1) then raise exception 'INVENTORY_INVALID_QUANTITY';end if;
  select * into p from public.inventory_products where id=(x->>'product_id')::uuid and active;
  if p.id is null then raise exception 'INVENTORY_PRODUCT_NOT_FOUND';end if;
  if (p_kind='consumption' and p.stock_qty<(x->>'quantity')::int) or (p_kind='adjustment' and p.stock_qty+(x->>'quantity')::int<0) then raise exception 'INVENTORY_STOCK_INSUFFICIENT';end if;
  costs:=costs||jsonb_build_array(jsonb_build_object('product_id',p.id,'name',p.name,'bottle_ml',p.bottle_ml,'unit_cost_agorot',p.cost_agorot::text,'total_cost_agorot',(abs((x->>'quantity')::int)::bigint*p.cost_agorot)::text));
 end loop;
 perform pg_advisory_xact_lock(hashtextextended(p_key::text,27));
 select * into r from public.inventory_reports where id=p_key;
 if r.id is not null then
  if r.actor_id<>p_actor or r.kind<>p_kind or r.event_id is distinct from p_event or r.lines<>p_lines then raise exception 'INVENTORY_KEY_CONFLICT';end if;return r.id;
 end if;
 insert into public.inventory_reports(id,actor_id,inbox_id,kind,event_id,lines,reason,preview_costs,event_snapshot) values(p_key,p_actor,p_inbox,p_kind,p_event,p_lines,p_reason,costs,snap);return p_key;
end;$$;

create or replace function public.inventory_confirm(p_actor uuid,p_report uuid,p_decision uuid default null) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare r public.inventory_reports;x jsonb;p public.inventory_products;role_name text;q public.whatsapp_attendance_inbox;delta int;snap jsonb;begin
 role_name:=public.inventory_role(p_actor);select * into r from public.inventory_reports where id=p_report for update;
 if r.id is null or r.actor_id<>p_actor then return jsonb_build_object('status','forbidden');end if;
 if r.status in ('confirmed','reversed') then return jsonb_build_object('status','succeeded','replayed',true);end if;
 if r.status<>'pending' then return jsonb_build_object('status','cancelled');end if;
 if r.inbox_id is not null then
  select * into q from public.whatsapp_attendance_inbox where id=r.inbox_id;
  if not exists(select 1 from public.whatsapp_attendance_decisions d where d.id=p_decision and d.inbox_id=q.id and d.actor_id=p_actor and d.status='processing' and d.source_type='interactive.button_reply' and d.token=q.confirmation_token and d.received_at<=q.confirmation_expires_at) then return jsonb_build_object('status','forbidden');end if;
  perform s.phone from public.whatsapp_attendance_senders s where s.phone=q.phone for share;
  if not exists(select 1 from public.whatsapp_attendance_senders where phone=q.phone and user_id=p_actor and enabled) then return jsonb_build_object('status','forbidden');end if;
  if r.kind='receipt' then perform phone from public.inventory_sender_permissions where phone=q.phone for share;if not exists(select 1 from public.inventory_sender_permissions where phone=q.phone and user_id=p_actor and can_receive) then return jsonb_build_object('status','forbidden');end if;end if;
 elsif r.kind<>'consumption' and role_name<>'owner' then return jsonb_build_object('status','forbidden');end if;
 if r.kind='consumption' then select jsonb_build_object('id',e.id,'event_date',e.event_date,'venue_id',e.venue_id,'client_name',e.client_name) into snap from public.events e where id=r.event_id for share;
  if snap is null then return jsonb_build_object('status','event_missing');end if;if snap is distinct from r.event_snapshot then return jsonb_build_object('status','event_changed');end if;
 end if;
 -- Stable lock order prevents races between overlapping reports. Validate every
 -- line before any movement; prices are read from these locked rows, never AI.
 perform id from public.inventory_products where id in(select (value->>'product_id')::uuid from jsonb_array_elements(r.lines)) order by id for update;
 for x in select value from jsonb_array_elements(r.lines) loop
  select * into p from public.inventory_products where id=(x->>'product_id')::uuid;
  if p.id is null or not p.active then return jsonb_build_object('status','product_inactive');end if;
  if not exists(select 1 from jsonb_array_elements(r.preview_costs) old_product where old_product->>'product_id'=p.id::text and old_product->>'name'=p.name and (old_product->>'bottle_ml')::int=p.bottle_ml) then return jsonb_build_object('status','product_changed');end if;
  delta:=case when r.kind='consumption' then -(x->>'quantity')::int else (x->>'quantity')::int end;
  if p.stock_qty+delta<0 or p.stock_qty+delta>1000000 then return jsonb_build_object('status','insufficient_stock');end if;
 end loop;
 for x in select value from jsonb_array_elements(r.lines) loop
  select * into p from public.inventory_products where id=(x->>'product_id')::uuid;
  insert into public.inventory_movements(report_id,product_id,event_id,kind,quantity_delta,unit_cost_agorot,actor_id,reason)
   values(r.id,p.id,r.event_id,r.kind,case when r.kind='consumption' then -(x->>'quantity')::int else (x->>'quantity')::int end,p.cost_agorot,p_actor,r.reason);
 end loop;
 update public.inventory_reports set status='confirmed',confirmed_by=p_actor,confirmed_at=now() where id=r.id;
 return jsonb_build_object('status','succeeded','replayed',false);
end;$$;

create or replace function public.inventory_reverse(p_actor uuid,p_movement uuid,p_key uuid,p_reason text) returns uuid
language plpgsql security invoker set search_path='' as $$
declare m public.inventory_movements;existing uuid;p public.inventory_products;begin
 perform public.inventory_role(p_actor,true);if length(trim(coalesce(p_reason,'')))<2 then raise exception 'INVENTORY_REASON_REQUIRED';end if;
 select * into m from public.inventory_movements where id=p_movement for update;
 select report_id into existing from public.inventory_movements where correction_of=p_movement;if existing is not null then return existing;end if;
 if m.id is null or m.kind='reversal' then raise exception 'INVENTORY_INVALID_REVERSAL';end if;
 select * into p from public.inventory_products where id=m.product_id for update;
 if p.stock_qty-m.quantity_delta<0 then raise exception 'INVENTORY_STOCK_INSUFFICIENT';end if;
 insert into public.inventory_reports(id,actor_id,kind,event_id,lines,reason,status,confirmed_by,confirmed_at) values(p_key,p_actor,'reversal',m.event_id,'[]',p_reason,'confirmed',p_actor,now());
 insert into public.inventory_movements(report_id,product_id,event_id,kind,quantity_delta,unit_cost_agorot,actor_id,correction_of,reason)
  values(p_key,m.product_id,m.event_id,'reversal',-m.quantity_delta,m.unit_cost_agorot,p_actor,m.id,p_reason);
 if not exists(select 1 from public.inventory_movements original where original.report_id=m.report_id and not exists(select 1 from public.inventory_movements rev where rev.correction_of=original.id)) then update public.inventory_reports set status='reversed' where id=m.report_id;end if;
 return p_key;
end;$$;

create or replace function public.inventory_event_costs(p_actor uuid,p_events uuid[]) returns jsonb
language plpgsql security invoker set search_path='' as $$begin
 perform public.inventory_role(p_actor,true);
 return coalesce((select jsonb_agg(to_jsonb(x)) from(select m.event_id,sum(case when m.kind='consumption' then m.total_cost_agorot else -m.total_cost_agorot end)::text cost_agorot
  from public.inventory_movements m left join public.inventory_movements original on original.id=m.correction_of
  where m.event_id=any(p_events) and (m.kind='consumption' or (m.kind='reversal' and original.kind='consumption')) group by m.event_id)x),'[]'::jsonb);
end;$$;
create or replace function public.read_inventory_event_costs(p_events uuid[]) returns jsonb language plpgsql security invoker set search_path='' as $$begin
 if not exists(select 1 from public.profiles where id=auth.uid() and role='owner') then raise exception 'INVENTORY_FORBIDDEN' using errcode='42501';end if;
 return coalesce((select jsonb_agg(to_jsonb(x)) from(select m.event_id,sum(case when m.kind='consumption' then m.total_cost_agorot else -m.total_cost_agorot end)::text cost_agorot
  from public.inventory_movements m left join public.inventory_movements original on original.id=m.correction_of
  where m.event_id=any(p_events) and (m.kind='consumption' or (m.kind='reversal' and original.kind='consumption')) group by m.event_id)x),'[]'::jsonb);
end;$$;

create or replace function public.inventory_overview(p_actor uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
declare role_name text;begin role_name:=public.inventory_role(p_actor);
 return jsonb_build_object('products',coalesce((select jsonb_agg((to_jsonb(p)-'cost_agorot')||case when role_name='owner' then jsonb_build_object('cost_agorot',p.cost_agorot::text,'value_agorot',(p.stock_qty::bigint*p.cost_agorot)::text) else '{}'::jsonb end order by p.name,p.bottle_ml) from public.inventory_products p),'[]'::jsonb),
 'movements',coalesce((select jsonb_agg(x.value order by x.created_at desc) from(select (to_jsonb(m)-'unit_cost_agorot'-'total_cost_agorot')||jsonb_build_object('product_name',p.name,'bottle_ml',p.bottle_ml)||case when role_name='owner' then jsonb_build_object('unit_cost_agorot',m.unit_cost_agorot::text,'total_cost_agorot',m.total_cost_agorot::text) else '{}'::jsonb end value,m.created_at from public.inventory_movements m join public.inventory_products p on p.id=m.product_id order by m.created_at desc limit 500)x),'[]'::jsonb),
 'reports',coalesce((select jsonb_agg((to_jsonb(x)-'preview_costs')||case when role_name='owner' then jsonb_build_object('preview_costs',x.preview_costs) else '{}'::jsonb end order by x.created_at desc) from(select * from public.inventory_reports where role_name='owner' or actor_id=p_actor order by created_at desc limit 200)x),'[]'::jsonb),
 'events',coalesce((select jsonb_agg(to_jsonb(x)) from(select e.id,e.event_date,e.client_name,v.name venue_name from public.events e left join public.venues v on v.id=e.venue_id order by event_date desc limit 500)x),'[]'::jsonb),
 'inbox',coalesce((select jsonb_agg(to_jsonb(x) order by x.received_at desc) from(select q.id,q.actor_id,q.message_text,q.status,q.error_code,q.received_at,(select r.status from public.whatsapp_attendance_receipts r where r.inbox_id=q.id order by r.created_at desc limit 1) delivery_status from public.whatsapp_attendance_inbox q where q.report_type='inventory' and (role_name='owner' or q.actor_id=p_actor) order by q.received_at desc limit 200)x),'[]'::jsonb),
 'senders',case when role_name='owner' then coalesce((select jsonb_agg(jsonb_build_object('phone',s.phone,'can_receive',coalesce(p.can_receive and p.user_id=s.user_id,false))) from public.whatsapp_attendance_senders s left join public.inventory_sender_permissions p on p.phone=s.phone where s.enabled),'[]'::jsonb) else '[]'::jsonb end);
end;$$;

grant usage,select on sequence public.inventory_product_audit_id_seq to service_role;
grant select on public.events,public.venues,public.profiles to service_role;
-- Row locking requires UPDATE privilege on a column; only the trusted server
-- receives this grant. Owner/manager browser permissions are unchanged.
grant update(id) on public.events,public.profiles to service_role;
do $$begin if to_regclass('public.app_notifications') is not null then grant insert on public.app_notifications to service_role;end if;end;$$;
do $$declare f record;begin for f in select oid::regprocedure signature,proname from pg_proc where pronamespace='public'::regnamespace and (proname like 'inventory\_%' escape '\' or proname='read_inventory_event_costs') loop
 execute format('revoke all on function %s from public,anon,authenticated',f.signature);
 execute format('grant execute on function %s to service_role',f.signature);
 if f.proname='read_inventory_event_costs' then execute format('grant execute on function %s to authenticated',f.signature);end if;
end loop;end;$$;
notify pgrst,'reload schema';
commit;
