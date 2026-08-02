create table public.venues (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create table public.bar_packages (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create table public.event_types (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create table public.payment_methods (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create trigger venues_set_updated_at before update on public.venues for each row execute function public.set_updated_at();
create trigger bar_packages_set_updated_at before update on public.bar_packages for each row execute function public.set_updated_at();
create trigger event_types_set_updated_at before update on public.event_types for each row execute function public.set_updated_at();
create trigger payment_methods_set_updated_at before update on public.payment_methods for each row execute function public.set_updated_at();

alter table public.venues enable row level security;
alter table public.bar_packages enable row level security;
alter table public.event_types enable row level security;
alter table public.payment_methods enable row level security;

create policy "Authenticated users can manage venues" on public.venues for all to authenticated using (true) with check (true);
create policy "Authenticated users can manage bar packages" on public.bar_packages for all to authenticated using (true) with check (true);
create policy "Authenticated users can manage event types" on public.event_types for all to authenticated using (true) with check (true);
create policy "Authenticated users can manage payment methods" on public.payment_methods for all to authenticated using (true) with check (true);

insert into public.bar_packages (name) values ('Pouring'), ('Premium'), ('Super Premium'), ('Ultra Premium');
insert into public.event_types (name) values ('Wedding'), ('Brit'), ('Bar Mitzvah'), ('Bat Mitzvah'), ('Business'), ('Henna'), ('Other');
