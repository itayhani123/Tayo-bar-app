create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  expense_date date not null,
  category text not null,
  supplier_name text,
  description text,
  amount numeric(12,2) not null,
  includes_vat boolean not null default true,
  vat_rate numeric(5,2) not null default 18,
  payment_method text,
  reference_number text,
  event_id uuid references public.events(id) on delete set null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.expenses
  add column if not exists expense_date date,
  add column if not exists category text,
  add column if not exists supplier_name text,
  add column if not exists description text,
  add column if not exists amount numeric(12,2),
  add column if not exists includes_vat boolean not null default true,
  add column if not exists vat_rate numeric(5,2) not null default 18,
  add column if not exists payment_method text,
  add column if not exists reference_number text,
  add column if not exists event_id uuid references public.events(id) on delete set null,
  add column if not exists notes text,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create index if not exists expenses_date_idx on public.expenses(expense_date);
create index if not exists expenses_category_idx on public.expenses(category);
create index if not exists expenses_event_id_idx on public.expenses(event_id);
alter table public.expenses enable row level security;

create table if not exists public.app_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  role_target text,
  notification_type text not null,
  title text not null,
  message text not null,
  severity text not null default 'info',
  entity_type text,
  entity_id uuid,
  action_url text,
  read_at timestamptz,
  dedupe_key text,
  created_at timestamptz not null default now()
);

alter table public.app_notifications
  add column if not exists user_id uuid references auth.users(id) on delete cascade,
  add column if not exists role_target text,
  add column if not exists notification_type text,
  add column if not exists title text,
  add column if not exists message text,
  add column if not exists severity text not null default 'info',
  add column if not exists entity_type text,
  add column if not exists entity_id uuid,
  add column if not exists action_url text,
  add column if not exists read_at timestamptz,
  add column if not exists dedupe_key text,
  add column if not exists created_at timestamptz not null default now();

create index if not exists app_notifications_user_idx on public.app_notifications(user_id, created_at desc);
create index if not exists app_notifications_role_idx on public.app_notifications(role_target, created_at desc);
create unique index if not exists app_notifications_dedupe_idx on public.app_notifications(dedupe_key) where dedupe_key is not null;
alter table public.app_notifications enable row level security;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'expenses_amount_check' and conrelid = 'public.expenses'::regclass) then
    alter table public.expenses add constraint expenses_amount_check check (amount > 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'expenses_vat_rate_check' and conrelid = 'public.expenses'::regclass) then
    alter table public.expenses add constraint expenses_vat_rate_check check (vat_rate >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'app_notifications_severity_check' and conrelid = 'public.app_notifications'::regclass) then
    alter table public.app_notifications add constraint app_notifications_severity_check check (severity in ('info','success','warning','error'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'app_notifications_role_check' and conrelid = 'public.app_notifications'::regclass) then
    alter table public.app_notifications add constraint app_notifications_role_check check (role_target is null or role_target in ('owner','manager'));
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'expenses_set_updated_at' and tgrelid = 'public.expenses'::regclass and not tgisinternal) then
    create trigger expenses_set_updated_at before update on public.expenses for each row execute function public.set_updated_at();
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='expenses' and policyname='Owners manage expenses') then
    create policy "Owners manage expenses" on public.expenses for all to authenticated
      using (exists (select 1 from public.profiles where id=auth.uid() and role='owner'))
      with check (exists (select 1 from public.profiles where id=auth.uid() and role='owner'));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='app_notifications' and policyname='Users read targeted notifications') then
    create policy "Users read targeted notifications" on public.app_notifications for select to authenticated using (
      user_id=auth.uid() or (user_id is null and role_target=(select role from public.profiles where id=auth.uid()))
    );
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='app_notifications' and policyname='Users update targeted notifications') then
    create policy "Users update targeted notifications" on public.app_notifications for update to authenticated using (
      user_id=auth.uid() or (user_id is null and role_target=(select role from public.profiles where id=auth.uid()))
    ) with check (
      user_id=auth.uid() or (user_id is null and role_target=(select role from public.profiles where id=auth.uid()))
    );
  end if;
end $$;

create or replace function public.notify_new_assignment() returns trigger language plpgsql security definer set search_path=public as $$
begin
  insert into public.app_notifications(role_target,notification_type,title,message,severity,entity_type,entity_id,action_url,dedupe_key)
  values
    ('owner','assignment_created','שיבוץ חדש נוצר','עובד חדש שובץ לאירוע.','success','event',new.event_id,'/events?event='||new.event_id,'assignment:'||new.id||':owner'),
    ('manager','assignment_created','שיבוץ חדש נוצר','עובד חדש שובץ לאירוע.','success','event',new.event_id,'/events?event='||new.event_id,'assignment:'||new.id||':manager')
  on conflict (dedupe_key) where dedupe_key is not null do nothing;
  return new;
end $$;

create or replace function public.notify_whatsapp_failure() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.status='failed' and old.status is distinct from 'failed' then
    insert into public.app_notifications(role_target,notification_type,title,message,severity,entity_type,entity_id,action_url,dedupe_key)
    values ('owner','whatsapp_failed','נכשלה שליחת הודעת WhatsApp',coalesce(new.error_message,'שליחת הודעת WhatsApp נכשלה.'),'error','event',new.event_id,'/settings/whatsapp-notifications','whatsapp-failed:'||new.id)
    on conflict (dedupe_key) where dedupe_key is not null do nothing;
  end if;
  return new;
end $$;

create or replace function public.refresh_app_notifications() returns void language plpgsql security definer set search_path=public as $$
declare israel_today date := (now() at time zone 'Asia/Jerusalem')::date;
begin
  if auth.uid() is null then raise exception 'Unauthorized'; end if;

  insert into public.app_notifications(role_target,notification_type,title,message,severity,entity_type,entity_id,action_url,dedupe_key)
  select target.role,'missing_staffing','אירוע מחר עדיין חסר צוות','לאירוע של '||e.client_name||' אין מספיק ברמנים משובצים.','warning','event',e.id,'/events?event='||e.id,'tomorrow-staff:'||e.id||':'||target.role
  from public.events e cross join (values ('owner'),('manager')) target(role)
  where e.event_date=israel_today+1 and (select count(*) from public.event_assignments a where a.event_id=e.id and a.event_role='bartender') < ceil(e.guest_count::numeric/70)+1
  on conflict (dedupe_key) where dedupe_key is not null do nothing;

  insert into public.app_notifications(role_target,notification_type,title,message,severity,entity_type,entity_id,action_url,dedupe_key)
  select target.role,'missing_work_time','חסרה שעת כניסה או יציאה','לעובד באירוע שהסתיים חסרות שעות עבודה.','warning','event',a.event_id,'/events?event='||a.event_id,'missing-time:'||a.id||':'||target.role
  from public.event_assignments a join public.events e on e.id=a.event_id cross join (values ('owner'),('manager')) target(role)
  where e.event_date<israel_today and a.pay_type='hourly' and (a.work_start is null or a.work_end is null)
  on conflict (dedupe_key) where dedupe_key is not null do nothing;

  insert into public.app_notifications(role_target,notification_type,title,message,severity,entity_type,entity_id,action_url,dedupe_key)
  select 'owner','open_receivable','קיימת יתרה פתוחה לגבייה','לאירוע של '||e.client_name||' קיימת יתרה פתוחה.','warning','event',e.id,'/receivables','receivable:'||e.id
  from public.events e
  where e.event_date<=israel_today and (
    case when e.price_includes_vat then e.guest_count*e.price_per_guest else e.guest_count*e.price_per_guest*(1+e.vat_rate/100) end
    - coalesce((select sum(p.amount) from public.event_payments p where p.event_id=e.id),0)
  ) > 0
  on conflict (dedupe_key) where dedupe_key is not null do nothing;
end $$;

do $$ begin
  if not exists (select 1 from pg_trigger where tgname='event_assignments_app_notification' and tgrelid='public.event_assignments'::regclass and not tgisinternal) then
    create trigger event_assignments_app_notification after insert on public.event_assignments for each row execute function public.notify_new_assignment();
  end if;
  if not exists (select 1 from pg_trigger where tgname='whatsapp_failure_app_notification' and tgrelid='public.whatsapp_notifications'::regclass and not tgisinternal) then
    create trigger whatsapp_failure_app_notification after update on public.whatsapp_notifications for each row execute function public.notify_whatsapp_failure();
  end if;
end $$;

revoke update on public.app_notifications from authenticated;
grant update(read_at) on public.app_notifications to authenticated;
revoke execute on function public.refresh_app_notifications() from public;
grant execute on function public.refresh_app_notifications() to authenticated;
