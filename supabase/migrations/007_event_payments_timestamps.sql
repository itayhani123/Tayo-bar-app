alter table public.event_payments
  add column if not exists created_at timestamp with time zone not null default now(),
  add column if not exists updated_at timestamp with time zone not null default now();

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'event_payments_set_updated_at'
      and tgrelid = 'public.event_payments'::regclass
      and not tgisinternal
  ) then
    create trigger event_payments_set_updated_at
    before update on public.event_payments
    for each row execute function public.set_updated_at();
  end if;
end;
$$;
