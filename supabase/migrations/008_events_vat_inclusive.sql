update public.events
set price_includes_vat = true
where price_includes_vat is false or price_includes_vat is null;

alter table public.events
  alter column price_includes_vat set default true,
  alter column price_includes_vat set not null;
