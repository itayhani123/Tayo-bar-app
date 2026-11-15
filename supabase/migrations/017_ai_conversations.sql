-- Private, role-bound conversation state. No business mutation capabilities are stored in model context.
begin;
create table public.ai_conversations (
  id uuid primary key,
  actor_id uuid not null references auth.users(id),
  actor_role text not null check (actor_role in ('owner','manager')),
  state jsonb not null default '{"input":[],"draft":null,"references":[]}',
  messages jsonb not null default '[]',
  lease_id uuid,
  lease_until timestamptz,
  active_request uuid,
  revision bigint not null default 0,
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null default now()+interval '24 hours'
);
create index ai_conversations_actor_expiry on public.ai_conversations(actor_id,expires_at);
create table public.ai_conversation_turns (
  conversation_id uuid not null references public.ai_conversations(id) on delete cascade,
  request_id uuid not null,
  fingerprint text not null,
  message text not null,
  response jsonb,
  primary key(conversation_id,request_id)
);
alter table public.ai_conversations enable row level security;
alter table public.ai_conversation_turns enable row level security;
revoke all on public.ai_conversations,public.ai_conversation_turns from public,anon,authenticated;
grant all on public.ai_conversations,public.ai_conversation_turns to service_role;

create function public.begin_ai_turn(p_actor uuid,p_role text,p_conversation uuid,p_request uuid,p_message text,p_selection jsonb) returns jsonb
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
  if (select count(*) from public.ai_conversation_turns where conversation_id=c.id)>=200 then raise exception 'Conversation full'; end if;
  lease := gen_random_uuid();
  insert into public.ai_conversation_turns(conversation_id,request_id,fingerprint,message) values(c.id,p_request,fingerprint,p_message) on conflict do nothing;
  update public.ai_conversations set lease_id=lease,lease_until=now()+interval '70 seconds',active_request=p_request where id=c.id;
  return jsonb_build_object('status','ready','lease',lease,'state',c.state,'messages',c.messages);
end;
$$;

create function public.finish_ai_turn(p_actor uuid,p_role text,p_conversation uuid,p_lease uuid,p_state jsonb,p_messages jsonb,p_response jsonb) returns boolean
language plpgsql security invoker set search_path='' as $$
declare c public.ai_conversations;
begin
  if not exists(select 1 from public.profiles where id=p_actor and role=p_role) then raise exception 'Unauthorized' using errcode='42501'; end if;
  select * into strict c from public.ai_conversations where id=p_conversation for update;
  if c.actor_id<>p_actor or c.actor_role<>p_role or c.lease_id is distinct from p_lease or c.lease_until<=now() then return false; end if;
  if octet_length(p_state::text)>150000 or octet_length(p_messages::text)>200000 or octet_length(p_response::text)>250000 then raise exception 'Conversation too large'; end if;
  update public.ai_conversation_turns set response=p_response where conversation_id=c.id and request_id=c.active_request;
  update public.ai_conversations set state=p_state,messages=p_messages,revision=revision+1,lease_id=null,lease_until=null,active_request=null,updated_at=now(),expires_at=now()+interval '24 hours' where id=c.id;
  return true;
end;
$$;
create function public.release_ai_turn(p_actor uuid,p_conversation uuid,p_lease uuid) returns void
language sql security invoker set search_path='' as $$
  update public.ai_conversations set lease_id=null,lease_until=null,active_request=null where id=p_conversation and actor_id=p_actor and lease_id=p_lease;
$$;
revoke all on function public.begin_ai_turn(uuid,text,uuid,uuid,text,jsonb),public.finish_ai_turn(uuid,text,uuid,uuid,jsonb,jsonb,jsonb),public.release_ai_turn(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.begin_ai_turn(uuid,text,uuid,uuid,text,jsonb),public.finish_ai_turn(uuid,text,uuid,uuid,jsonb,jsonb,jsonb),public.release_ai_turn(uuid,uuid,uuid) to service_role;
commit;
