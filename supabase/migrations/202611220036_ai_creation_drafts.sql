create or replace function app_private.ai_draft_execute(command text,body jsonb,key uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 case command
 when 'create_session' then perform public.execute_financial_command('create_session_bundle',key,body);
 when 'create_poll' then perform public.create_poll((body->>'g')::uuid,body->>'title_text',body->>'venue_text',(body->>'minimum')::integer,(body->>'deadline')::timestamptz,body->'options');
 when 'rsvp' then perform public.set_rsvp((body->>'sid')::uuid,(body->>'going')::boolean);
 when 'vote' then perform public.vote_poll((body->>'option_id')::uuid,body->>'answer');
 when 'mark_paid' then perform public.execute_financial_command('payment_action',key,jsonb_build_object('target',body->>'target','operation','mark'));
 when 'confirm_received' then perform public.execute_financial_command('payment_action',key,jsonb_build_object('target',body->>'target','operation','confirm'));
 when 'expense' then perform public.execute_financial_command('save_expense',key,body);
 when 'claim_collector' then perform public.execute_financial_command('claim_collector',key,body);
 when 'reminder' then perform public.remind_payment((body->>'target')::uuid);
 when 'session_request' then perform public.request_session_change((body->>'sid')::uuid,body->>'kind',body->'request');
 else raise exception 'Thao tác AI không được hỗ trợ';end case;
end $$;
revoke all on function app_private.ai_draft_execute(text,jsonb,uuid) from public,anon,authenticated,service_role;

create or replace function public.create_ai_draft(g uuid,command text,body jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare sid uuid;s public.sessions;actor uuid;authority uuid:=auth.uid();tier text;did uuid:=gen_random_uuid();snapshot jsonb;fingerprint text;item jsonb;
begin
 if not public.is_member(g) or body is null or jsonb_typeof(body)<>'object' or length(body::text)>50000 then raise exception 'Không có quyền hoặc dữ liệu không hợp lệ';end if;
 if not exists(select 1 from public.group_ai_settings where group_id=g and enabled and status='approved') then raise exception 'Nhóm chưa bật AI';end if;
 perform pg_advisory_xact_lock(hashtextextended('ai-draft:'||auth.uid(),0));
 if(select count(*) from public.ai_drafts where requested_by=auth.uid() and created_at>now()-interval '1 hour')>=30 then raise exception 'Quá nhiều bản nháp; thử lại sau';end if;
 select id into actor from public.group_members where group_id=g and user_id=auth.uid() and status='active';
 if command in ('create_session','create_poll') then
  if (body->>'g')::uuid is distinct from g then raise exception 'Sai nh?m';end if;
 elsif command in ('rsvp','expense','claim_collector','session_request') then sid:=(body->>'sid')::uuid;
 elsif command in ('mark_paid','confirm_received','reminder') then select session_id into sid from public.settlements where id=(body->>'target')::uuid;
 elsif command='vote' then
  if not exists(select 1 from public.poll_options o join public.polls p on p.id=o.poll_id where o.id=(body->>'option_id')::uuid and p.group_id=g) then raise exception 'Thăm dò không thuộc nhóm';end if;
 else raise exception 'Thao tác AI không được hỗ trợ';end if;
 if command not in ('vote','create_session','create_poll') then
  select * into s from public.sessions where id=sid for update;
  if not found or s.group_id<>g then raise exception 'Buổi không thuộc nhóm';end if;
 end if;
 tier:=case when command in ('rsvp','vote','mark_paid') then 'T1' else 'T2' end;
 if command='confirm_received' then tier:='T3';if not exists(select 1 from public.settlements p where p.id=(body->>'target')::uuid and p.to_member=actor) then raise exception 'Chỉ người nhận được yêu cầu xác nhận';end if;end if;
 if command='session_request' then tier:='T3';end if;
 if command='expense' then
  if actor is distinct from s.collector_member_id and not exists(select 1 from public.session_attendees where session_id=sid and member_id=actor and rsvp='going' and removed_at is null) then raise exception 'Chỉ người tham gia được đề xuất';end if;
  if exists(select 1 from public.settlements where session_id=sid) or actor is distinct from s.collector_member_id then tier:='T3';end if;
  if actor is distinct from s.collector_member_id then
   select user_id into authority from public.group_members where id=s.collector_member_id and status='active';
   if authority is null then raise exception 'Cần người tính tiền có tài khoản; dùng luồng dự phòng trong app';end if;
  end if;
 end if;
 -- Validate under the requester's actual authority without retaining writes.
 begin
  perform app_private.ai_draft_execute(command,body,did);
  if sid is not null then
   snapshot:=public.session_details(sid);
   snapshot:=snapshot-'settlements'-'history';
  end if;
  raise exception using errcode='PT006',message='AI preview rollback';
 exception when sqlstate 'PT006' then null;end;
 fingerprint:=encode(sha256(convert_to(jsonb_build_object('command',command,'body',body,'revision',s.revision,'tier',tier,'authority',authority)::text,'UTF8')),'hex');
 insert into public.ai_drafts(id,group_id,session_id,requested_by,authority_id,command,body,payload_hash,session_revision,tier,preview,expires_at) values(did,g,sid,auth.uid(),authority,command,body,fingerprint,s.revision,tier,snapshot,now()+case when tier='T3' then interval '72 hours' else interval '15 minutes' end);
 if tier='T3' then insert into public.notifications(group_id,user_id,event_key,title,href) values(g,authority,'ai-review:'||did,'Có yêu cầu AI cần xem và duyệt trong app','/ai/drafts/'||did);end if;
 return jsonb_build_object('id',did,'tier',tier,'hash',fingerprint,'href','/ai/drafts/'||did,'status','pending');
end $$;


revoke all on function public.create_ai_draft(uuid,text,jsonb) from public,anon,service_role;
grant execute on function public.create_ai_draft(uuid,text,jsonb) to authenticated;
