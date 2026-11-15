-- Persist incoming intent before model work, so refresh/disconnect cannot erase an in-flight request.
begin;
create or replace function public.begin_ai_turn(p_actor uuid,p_role text,p_conversation uuid,p_request uuid,p_message text,p_selection jsonb) returns jsonb
language plpgsql security invoker set search_path='' set lock_timeout='3s' as $$
declare c public.ai_conversations; t public.ai_conversation_turns; lease uuid; fingerprint text;
begin
  if not exists(select 1 from public.profiles where id=p_actor and role=p_role and role in ('owner','manager')) then raise exception 'Unauthorized' using errcode='42501'; end if;
  if length(p_message)<1 or length(p_message)>2000 then raise exception 'Invalid message'; end if;
  delete from public.ai_conversations where actor_id=p_actor and expires_at<now() and coalesce(lease_until,now())<=now();
  if not exists(select 1 from public.ai_conversations where id=p_conversation) and (select count(*) from public.ai_conversations where actor_id=p_actor)>=20 then raise exception 'Conversation limit'; end if;
  insert into public.ai_conversations(id,actor_id,actor_role) values(p_conversation,p_actor,p_role) on conflict(id) do nothing;
  select * into strict c from public.ai_conversations where id=p_conversation for update;
  if c.actor_id<>p_actor or c.actor_role<>p_role or c.expires_at<=now() then raise exception 'Unauthorized' using errcode='42501'; end if;
  fingerprint := md5(p_message||coalesce(p_selection::text,''));
  select * into t from public.ai_conversation_turns where conversation_id=c.id and request_id=p_request;
  if t.request_id is not null and t.fingerprint<>fingerprint then raise exception 'Request ID reused'; end if;
  if t.response is not null then return jsonb_build_object('status','completed','response',t.response); end if;
  if c.lease_until>now() then return jsonb_build_object('status','busy'); end if;
  if t.request_id is null and (select count(*) from public.ai_conversation_turns where conversation_id=c.id)>=200 then raise exception 'Conversation full'; end if;
  if t.request_id is null then
    if p_selection is not null and not exists(
      select 1 from jsonb_array_elements(coalesce((c.messages->(jsonb_array_length(c.messages)-1))->'choices','[]'::jsonb)) choice
      where choice->>'id'=p_selection->>'id' and choice->>'kind'=p_selection->>'kind'
    ) then raise exception 'Invalid selection' using errcode='22023'; end if;
    c.messages := c.messages||jsonb_build_array(jsonb_build_object('role','user','content',p_message));
    c.state := jsonb_set(c.state,'{input}',coalesce(c.state->'input','[]'::jsonb)||jsonb_build_array(jsonb_build_object('role','user','content',p_message)));
    insert into public.ai_conversation_turns(conversation_id,request_id,fingerprint,message) values(c.id,p_request,fingerprint,p_message);
  end if;
  lease := gen_random_uuid();
  update public.ai_conversations set state=c.state,messages=c.messages,lease_id=lease,lease_until=now()+interval '70 seconds',active_request=p_request where id=c.id;
  return jsonb_build_object('status','ready','protocolVersion',2,'lease',lease,'state',c.state,'messages',c.messages);
end;
$$;

create function public.checkpoint_ai_turn(p_actor uuid,p_conversation uuid,p_lease uuid,p_state jsonb) returns boolean
language plpgsql security invoker set search_path='' as $$
begin
  if octet_length(p_state::text)>150000 then return false; end if;
  update public.ai_conversations c set state=p_state where c.id=p_conversation and c.actor_id=p_actor and c.lease_id=p_lease and c.lease_until>now()
    and exists(select 1 from public.profiles p where p.id=p_actor and p.role=c.actor_role);
  return found;
end;
$$;
revoke all on function public.checkpoint_ai_turn(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.checkpoint_ai_turn(uuid,uuid,uuid,jsonb) to service_role;
commit;
