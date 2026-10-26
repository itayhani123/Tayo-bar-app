-- Preserve legacy ledger amounts and immutable snapshots. Legacy allocations are reconstructed by the server.
begin;
alter table public.venue_settlements add column includes_hall_fee boolean not null default true;
alter table public.venue_settlements add column allocations jsonb;
create or replace function public.venue_settlement_snapshot(p_venue_id uuid) returns jsonb
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
      'createdBy', created_by, 'createdAt', created_at, 'includesHallFee', includes_hall_fee, 'allocations', allocations, 'sourceEvents', case when allocations is null then source_snapshot->'events' else null end
    ) order by cutoff_date, created_at, id) from public.venue_settlements where venue_id = p_venue_id), '[]'::jsonb)
  );
$$;


drop function public.close_venue_settlement(uuid,date,numeric,uuid,uuid,jsonb);
create function public.close_venue_settlement(
  p_venue_id uuid, p_cutoff_date date, p_amount numeric, p_created_by uuid,
  p_request_id uuid, p_snapshot jsonb, p_includes_hall_fee boolean default true, p_allocations jsonb default null
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
    if existing.venue_id <> p_venue_id or existing.cutoff_date <> p_cutoff_date or existing.created_by <> p_created_by or existing.includes_hall_fee <> p_includes_hall_fee then
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
  if p_allocations is not null then
    if jsonb_typeof(p_allocations) <> 'array' then
      raise exception 'Invalid allocations' using errcode = '22023';
    end if;
    if (select coalesce(sum((a->>'payment')::numeric - (a->>'hallFee')::numeric), 0) from jsonb_array_elements(p_allocations) a) <> p_amount
      or exists (select 1 from jsonb_array_elements(p_allocations) a where a->>'eventId' is null or a->>'payment' is null or a->>'hallFee' is null or (not p_includes_hall_fee and (a->>'hallFee')::numeric <> 0))
      or (select count(*) <> count(distinct a->>'eventId') from jsonb_array_elements(p_allocations) a) then
      raise exception 'Invalid allocations' using errcode = '22023';
    end if;
  end if;
  insert into public.venue_settlements(venue_id, cutoff_date, amount, created_by, request_id, source_snapshot, includes_hall_fee, allocations)
    values (p_venue_id, p_cutoff_date, p_amount, p_created_by, p_request_id, p_snapshot, p_includes_hall_fee, p_allocations)
    returning id into result_id;
  return result_id;
end;
$$;

revoke all on function public.close_venue_settlement(uuid,date,numeric,uuid,uuid,jsonb,boolean,jsonb) from public, anon, authenticated;
grant execute on function public.close_venue_settlement(uuid,date,numeric,uuid,uuid,jsonb,boolean,jsonb) to service_role;
commit;
