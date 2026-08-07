create table if not exists public.whatsapp_notifications (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id),
  event_id uuid references public.events(id) on delete cascade,
  assignment_id uuid references public.event_assignments(id) on delete cascade,
  notification_type text not null,
  scheduled_for timestamp with time zone,
  sent_at timestamp with time zone,
  status text not null default 'pending',
  provider_message_id text,
  error_message text,
  payload jsonb,
  dedupe_key text not null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

alter table public.whatsapp_notifications
  add column if not exists provider_message_id text,
  add column if not exists error_message text,
  add column if not exists payload jsonb,
  add column if not exists dedupe_key text,
  add column if not exists updated_at timestamp with time zone not null default now();

create index if not exists whatsapp_notifications_scheduled_for_idx on public.whatsapp_notifications(scheduled_for);
create index if not exists whatsapp_notifications_status_idx on public.whatsapp_notifications(status);
create index if not exists whatsapp_notifications_employee_id_idx on public.whatsapp_notifications(employee_id);
create index if not exists whatsapp_notifications_event_id_idx on public.whatsapp_notifications(event_id);
create index if not exists whatsapp_notifications_assignment_id_idx on public.whatsapp_notifications(assignment_id);
create unique index if not exists whatsapp_notifications_dedupe_key_idx on public.whatsapp_notifications(dedupe_key) where dedupe_key is not null;

alter table public.whatsapp_notifications enable row level security;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'whatsapp_notifications_type_check' and conrelid = 'public.whatsapp_notifications'::regclass) then
    alter table public.whatsapp_notifications add constraint whatsapp_notifications_type_check check (notification_type in ('assignment_created', 'event_changed', 'reminder_day_before', 'reminder_hours_before', 'work_time_updated'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'whatsapp_notifications_status_check' and conrelid = 'public.whatsapp_notifications'::regclass) then
    alter table public.whatsapp_notifications add constraint whatsapp_notifications_status_check check (status in ('pending', 'processing', 'sent', 'delivered', 'read', 'failed', 'cancelled'));
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'whatsapp_notifications_set_updated_at' and tgrelid = 'public.whatsapp_notifications'::regclass and not tgisinternal) then
    create trigger whatsapp_notifications_set_updated_at before update on public.whatsapp_notifications for each row execute function public.set_updated_at();
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'whatsapp_notifications' and policyname = 'Owners manage WhatsApp notifications') then
    create policy "Owners manage WhatsApp notifications" on public.whatsapp_notifications for all to authenticated
      using (exists (select 1 from public.profiles where id = auth.uid() and role = 'owner'))
      with check (exists (select 1 from public.profiles where id = auth.uid() and role = 'owner'));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'whatsapp_notifications' and policyname = 'Managers enqueue WhatsApp notifications') then
    create policy "Managers enqueue WhatsApp notifications" on public.whatsapp_notifications for insert to authenticated
      with check (exists (select 1 from public.profiles where id = auth.uid() and role = 'manager'));
  end if;
end;
$$;

insert into public.business_settings (key, numeric_value) values
  ('whatsapp_notifications_enabled', 0),
  ('whatsapp_assignment_enabled', 1),
  ('whatsapp_event_change_enabled', 1),
  ('whatsapp_day_before_enabled', 1),
  ('whatsapp_hours_before_enabled', 1),
  ('whatsapp_hours_before', 4),
  ('whatsapp_work_time_enabled', 1),
  ('whatsapp_salary_in_owner_messages', 0)
on conflict (key) do nothing;
