alter table public.event_types
  add column if not exists color_hex text;

update public.event_types set color_hex = case name
  when 'Wedding' then '#7C3AED'
  when 'Brit' then '#2563EB'
  when 'Bar Mitzvah' then '#0891B2'
  when 'Bat Mitzvah' then '#DB2777'
  when 'Business' then '#475569'
  when 'Henna' then '#EA580C'
  when 'Other' then '#16A34A'
  else '#475569'
end where color_hex is null;

alter table public.events
  add column if not exists vat_rate numeric(5,2) not null default 18,
  add column if not exists price_includes_vat boolean not null default false;

create table if not exists public.business_settings (
  id uuid primary key default gen_random_uuid(),
  key text unique not null,
  numeric_value numeric,
  text_value text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

insert into public.business_settings (key, numeric_value)
values ('income_tax_advance_rate', 3.2)
on conflict (key) do nothing;

alter table public.business_settings enable row level security;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'business_settings_set_updated_at' and tgrelid = 'public.business_settings'::regclass and not tgisinternal) then
    create trigger business_settings_set_updated_at before update on public.business_settings for each row execute function public.set_updated_at();
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'business_settings' and policyname = 'Authenticated users can manage business settings') then
    create policy "Authenticated users can manage business settings" on public.business_settings for all to authenticated using (true) with check (true);
  end if;
end;
$$;
