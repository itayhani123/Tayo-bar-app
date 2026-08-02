alter table public.employees
  alter column full_name type text,
  alter column full_name set not null,
  alter column phone type text,
  alter column phone drop not null;

alter table public.employees
  add column if not exists default_hourly_rate numeric(10,2) not null default 50,
  add column if not exists active boolean not null default true,
  add column if not exists notes text,
  add column if not exists updated_at timestamp with time zone not null default now();

alter table public.employees
  alter column default_hourly_rate type numeric(10,2),
  alter column default_hourly_rate set default 50,
  alter column default_hourly_rate set not null,
  alter column active set default true,
  alter column active set not null,
  alter column notes type text,
  alter column notes drop not null,
  alter column updated_at set default now(),
  alter column updated_at set not null;

alter table public.employees enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'employees_set_updated_at'
      and tgrelid = 'public.employees'::regclass
      and not tgisinternal
  ) then
    create trigger employees_set_updated_at
    before update on public.employees
    for each row execute function public.set_updated_at();
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'employees'
      and policyname = 'Authenticated users can manage employees'
  ) then
    create policy "Authenticated users can manage employees"
    on public.employees for all to authenticated
    using (true) with check (true);
  end if;
end;
$$;
