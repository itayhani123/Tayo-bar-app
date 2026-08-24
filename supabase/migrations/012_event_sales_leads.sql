-- No defaults and no UPDATE statements: existing events remain non-leads.
alter table public.events
  add column if not exists sales_status text,
  add column if not exists lead_source text,
  add column if not exists sales_notes text,
  add column if not exists last_contact_at timestamp with time zone,
  add column if not exists next_follow_up_at timestamp with time zone,
  add column if not exists proposal_amount numeric,
  add column if not exists closed_at timestamp with time zone;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'events_sales_status_check' and conrelid = 'public.events'::regclass) then
    alter table public.events add constraint events_sales_status_check check
      (sales_status is null or sales_status in ('lead', 'contacted', 'proposal_sent', 'waiting', 'won', 'lost'));
  end if;
end $$;

create index if not exists events_active_sales_idx on public.events(sales_status, next_follow_up_at)
  where sales_status in ('lead', 'contacted', 'proposal_sent', 'waiting');

alter table public.whatsapp_notifications alter column employee_id drop not null;
alter table public.whatsapp_notifications drop constraint if exists whatsapp_notifications_type_check;
alter table public.whatsapp_notifications add constraint whatsapp_notifications_type_check check
  (notification_type in ('assignment_created', 'event_changed', 'reminder_day_before', 'reminder_hours_before', 'work_time_updated', 'lead_welcome'));

insert into public.business_settings (key, numeric_value) values ('whatsapp_lead_welcome_enabled', 1)
on conflict (key) do nothing;
