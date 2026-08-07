insert into public.payment_methods (name)
values
  ('Cash'),
  ('Bank Transfer'),
  ('Check'),
  ('Bit'),
  ('PayBox')
on conflict (name) do nothing;
