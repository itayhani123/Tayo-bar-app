begin;

-- The inbox API orders multiple outbound messages by their immutable creation time.
-- 020/022 did not define this column. Preserve existing messages and delivery state.
alter table public.whatsapp_attendance_receipts
  add column if not exists created_at timestamptz;
-- Historical creation time was not recorded. Use the existing source-message time
-- as a deterministic backfill, rather than inventing historical delivery times.
update public.whatsapp_attendance_receipts
  set created_at = message_at where created_at is null;
alter table public.whatsapp_attendance_receipts
  alter column created_at set default now(),
  alter column created_at set not null;

notify pgrst, 'reload schema';
commit;
