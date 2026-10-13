-- Append-only financial ledger. No source financial records are modified.
begin;
create table public.venue_settlements (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues(id),
  cutoff_date date not null,
  amount numeric(16,2) not null check (amount <> 0),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  request_id uuid not null unique,
  source_snapshot jsonb not null
);
create index venue_settlements_venue_cutoff_idx on public.venue_settlements(venue_id, cutoff_date);
alter table public.venue_settlements enable row level security;
revoke all on public.venue_settlements from anon, authenticated;
grant select on public.venue_settlements to authenticated;
grant all on public.venue_settlements to service_role;
create policy "Owners read venue settlements" on public.venue_settlements
  for select to authenticated using (exists (select 1 from public.profiles where id = auth.uid() and role = 'owner'));

-- Single statement snapshot avoids pagination limits and inconsistent event/payment reads.
-- Execution is restricted to the trusted application server, never the browser.
create function public.venue_settlement_snapshot(p_venue_id uuid) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'venue', (select jsonb_build_object('id', id, 'name', name) from public.venues where id = p_venue_id),
    'events', coalesce((select jsonb_agg(jsonb_build_object(
      'id', e.id, 'eventDate', e.event_date, 'eventType', e.event_type,
      'venueId', e.venue_id, 'venueName', v.name, 'clientName', e.client_name,
      'clientPhone', coalesce(e.client_phone, ''), 'payerType', e.payer_type,
      'guestCount', coalesce(e.guest_count, 0), 'packageType', e.package_type,
      'pricePerGuest', e.price_per_guest, 'vatRate', e.vat_rate,
      'priceIncludesVat', e.price_includes_vat, 'notes', coalesce(e.notes, ''),
      'payments', coalesce((select jsonb_agg(jsonb_build_object('amount', p.amount,
        'paidAt', p.paid_at, 'paymentMethod', p.payment_method) order by p.id)
        from public.event_payments p where p.event_id = e.id), '[]'::jsonb)
    ) order by e.id) from public.events e join public.venues v on v.id = e.venue_id
      where e.venue_id = p_venue_id), '[]'::jsonb),
    'settlements', coalesce((select jsonb_agg(jsonb_build_object(
      'id', id, 'venueId', venue_id, 'cutoffDate', cutoff_date, 'amount', amount,
      'createdBy', created_by, 'createdAt', created_at
    ) order by cutoff_date, created_at, id) from public.venue_settlements where venue_id = p_venue_id), '[]'::jsonb)
  );
$$;

-- The amount is calculated by the authenticated owner API with the canonical TS
-- calculator. Only service_role can call this function. The snapshot comparison
-- under write-conflicting locks makes calculation + insertion optimistic/atomic.
create function public.close_venue_settlement(
  p_venue_id uuid, p_cutoff_date date, p_amount numeric, p_created_by uuid,
  p_request_id uuid, p_snapshot jsonb
) returns uuid language plpgsql security invoker set search_path = '' set lock_timeout = '5s' as $$
declare existing public.venue_settlements; result_id uuid;
begin
  if not exists (select 1 from public.profiles where id = p_created_by and role = 'owner') then
    raise exception 'Owner required' using errcode = '42501';
  end if;
  if p_cutoff_date is null or p_cutoff_date > (now() at time zone 'Asia/Jerusalem')::date then
    raise exception 'Invalid cutoff' using errcode = '22023';
  end if;
  -- Brief global locks also cover concurrent inserts/deletes and venue renames;
  -- row locks alone do not prevent phantom events or payments.
  lock table public.venues, public.events, public.event_payments, public.venue_settlements in share row exclusive mode;
  select * into existing from public.venue_settlements where request_id = p_request_id;
  if found then
    if existing.venue_id <> p_venue_id or existing.cutoff_date <> p_cutoff_date or existing.created_by <> p_created_by then
      raise exception 'Request ID already used' using errcode = '22023';
    end if;
    return existing.id;
  end if;
  if exists (select 1 from public.venue_settlements where venue_id = p_venue_id and cutoff_date > p_cutoff_date) then
    raise exception 'Retroactive cutoff' using errcode = '22023';
  end if;
  if public.venue_settlement_snapshot(p_venue_id) is distinct from p_snapshot then
    raise exception 'Settlement changed; preview again' using errcode = '40001';
  end if;
  if p_amount is null or p_amount = 0 or p_amount <> round(p_amount, 2) then
    raise exception 'Invalid settlement amount' using errcode = '22023';
  end if;
  insert into public.venue_settlements(venue_id, cutoff_date, amount, created_by, request_id, source_snapshot)
    values (p_venue_id, p_cutoff_date, p_amount, p_created_by, p_request_id, p_snapshot)
    returning id into result_id;
  return result_id;
end;
$$;
revoke all on function public.venue_settlement_snapshot(uuid) from public, anon, authenticated;
revoke all on function public.close_venue_settlement(uuid,date,numeric,uuid,uuid,jsonb) from public, anon, authenticated;
grant execute on function public.venue_settlement_snapshot(uuid) to service_role;
grant execute on function public.close_venue_settlement(uuid,date,numeric,uuid,uuid,jsonb) to service_role;
commit;
