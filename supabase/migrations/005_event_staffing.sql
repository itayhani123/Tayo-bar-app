create table if not exists public.event_assignments (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  employee_id uuid not null references public.employees(id),
  event_role text not null default 'bartender',
  pay_type text not null default 'hourly',
  hourly_rate numeric(10,2),
  fixed_pay numeric(10,2),
  work_start timestamp with time zone,
  work_end timestamp with time zone,
  notes text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

alter table public.event_assignments
  add column if not exists event_role text not null default 'bartender',
  add column if not exists pay_type text not null default 'hourly',
  add column if not exists hourly_rate numeric(10,2) default 50,
  add column if not exists fixed_pay numeric(10,2),
  add column if not exists work_start timestamp with time zone,
  add column if not exists work_end timestamp with time zone,
  add column if not exists notes text,
  add column if not exists updated_at timestamp with time zone not null default now();

alter table public.event_assignments
  alter column event_role set default 'bartender',
  alter column event_role set not null,
  alter column pay_type set default 'hourly',
  alter column pay_type set not null,
  alter column hourly_rate type numeric(10,2),
  alter column fixed_pay type numeric(10,2),
  alter column notes type text,
  alter column updated_at set default now(),
  alter column updated_at set not null;

create index if not exists event_assignments_event_id_idx on public.event_assignments(event_id);
create index if not exists event_assignments_employee_id_idx on public.event_assignments(employee_id);

alter table public.event_assignments enable row level security;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'event_assignments_event_role_check' and conrelid = 'public.event_assignments'::regclass) then
    alter table public.event_assignments add constraint event_assignments_event_role_check check (event_role in ('bartender', 'manager'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'event_assignments_pay_type_check' and conrelid = 'public.event_assignments'::regclass) then
    alter table public.event_assignments add constraint event_assignments_pay_type_check check (pay_type in ('hourly', 'fixed'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'event_assignments_pay_values_check' and conrelid = 'public.event_assignments'::regclass) then
    alter table public.event_assignments add constraint event_assignments_pay_values_check check ((pay_type = 'hourly' and hourly_rate is not null and hourly_rate >= 0 and fixed_pay is null) or (pay_type = 'fixed' and fixed_pay is not null and fixed_pay >= 0 and hourly_rate is null));
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'event_assignments_set_updated_at' and tgrelid = 'public.event_assignments'::regclass and not tgisinternal) then
    create trigger event_assignments_set_updated_at before update on public.event_assignments for each row execute function public.set_updated_at();
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'event_assignments' and policyname = 'Authenticated users can manage event assignments') then
    create policy "Authenticated users can manage event assignments" on public.event_assignments for all to authenticated using (true) with check (true);
  end if;
end;
$$;
