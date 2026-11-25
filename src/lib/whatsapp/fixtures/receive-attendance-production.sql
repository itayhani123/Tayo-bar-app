CREATE OR REPLACE FUNCTION public.receive_whatsapp_attendance(p_message_id text, p_phone text, p_phone_id text, p_text text, p_at timestamp with time zone)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare uid uuid;
begin
 select s.user_id into uid from public.whatsapp_attendance_senders s join public.profiles p on p.id=s.user_id where s.phone=p_phone and s.enabled and p.role in ('owner','manager');
 if uid is null then return false; end if;
 -- Per-sender durable cost cap. Duplicate deliveries are acknowledged even at the cap.
 perform pg_advisory_xact_lock(hashtextextended(p_phone,0));
 if exists(select 1 from public.whatsapp_attendance_inbox where provider_message_id=p_message_id) then return true; end if;
 if (select count(*) from public.whatsapp_attendance_inbox where phone=p_phone and received_at>now()-interval '1 hour')>=30 then return false; end if;
 insert into public.whatsapp_attendance_inbox(provider_message_id,phone,actor_id,phone_number_id,message_text,message_at) values(p_message_id,p_phone,uid,p_phone_id,p_text,p_at) on conflict(provider_message_id) do nothing;
 return true;
end; $function$
