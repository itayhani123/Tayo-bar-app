create table public.events (
  id uuid primary key default gen_random_uuid(),
  event_date date not null,
  start_time time not null,
  event_type text not null,
  venue_id uuid references public.venues(id),
  client_name text not null,
  client_phone text,
  guest_count integer not null check (guest_count > 0),
  price_per_guest numeric(10,2) not null check (price_per_guest >= 0),
  package_type text not null,
  payer_type text not null,
  payment_status text not null default 'unpaid',
  manager_employee_id uuid references public.employees(id),
  security_check_received boolean not null default false,
  invoice_issued boolean not null default false,
  estimated_alcohol_cost numeric(10,2) not null default 0 check (estimated_alcohol_cost >= 0),
  notes text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint events_payment_status_check check (payment_status in ('unpaid', 'partial', 'paid')),
  constraint events_payer_type_check check (payer_type in ('client', 'venue'))
);

create table public.event_payments (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  amount numeric(10,2) not null check (amount >= 0),
  payment_method text not null,
  payer_type text not null,
  paid_at timestamp with time zone not null default now(),
  notes text
);

create table public.event_assignments (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  employee_id uuid not null references public.employees(id),
  role text not null,
  is_manager boolean not null default false,
  created_at timestamp with time zone not null default now()
);

create index events_event_date_idx on public.events(event_date);
create index event_payments_event_id_idx on public.event_payments(event_id);
create index event_assignments_event_id_idx on public.event_assignments(event_id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger events_set_updated_at
before update on public.events
for each row execute function public.set_updated_at();

alter table public.events enable row level security;
alter table public.event_payments enable row level security;
alter table public.event_assignments enable row level security;

create policy "Authenticated users can manage events"
on public.events for all to authenticated
using (true) with check (true);

create policy "Authenticated users can manage event payments"
on public.event_payments for all to authenticated
using (true) with check (true);

create policy "Authenticated users can manage event assignments"
on public.event_assignments for all to authenticated
using (true) with check (true);
