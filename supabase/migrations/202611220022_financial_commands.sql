alter function public.create_session(uuid,text,text,timestamptz,timestamptz,boolean,uuid[],text,boolean) set schema app_private;
revoke all on function app_private.create_session(uuid,text,text,timestamptz,timestamptz,boolean,uuid[],text,boolean) from public,anon,authenticated,service_role;
alter function public.add_expense(uuid,bigint,text,text,uuid,uuid[],text,text,text[],text) set schema app_private;
revoke all on function app_private.add_expense(uuid,bigint,text,text,uuid,uuid[],text,text,text[],text) from public,anon,authenticated,service_role;
alter function public.apply_financial_change(uuid,bigint,text,jsonb) set schema app_private;
revoke all on function app_private.apply_financial_change(uuid,bigint,text,jsonb) from public,anon,authenticated,service_role;
alter function public.finish_session(uuid,bigint,text) set schema app_private;
revoke all on function app_private.finish_session(uuid,bigint,text) from public,anon,authenticated,service_role;
alter function public.claim_collector(uuid,bigint,text) set schema app_private;
revoke all on function app_private.claim_collector(uuid,bigint,text) from public,anon,authenticated,service_role;
alter function public.payment_action(uuid,text) set schema app_private;
revoke all on function app_private.payment_action(uuid,text) from public,anon,authenticated,service_role;
alter function public.decide_session_request(uuid,boolean,text) set schema app_private;
revoke all on function app_private.decide_session_request(uuid,boolean,text) from public,anon,authenticated,service_role;

create table app_private.financial_command_results (
 actor_id uuid not null references auth.users,
 request_key uuid not null,
 command_name text not null,
 payload_hash text not null,
 group_id uuid not null references public.groups,
 session_id uuid not null references public.sessions,
 result jsonb not null,
 created_at timestamptz not null default now(),
 primary key(actor_id,request_key)
);
alter table app_private.financial_command_results enable row level security;
revoke all on app_private.financial_command_results from public,anon,authenticated,service_role;

create function public.execute_financial_command(command_name text,request_key uuid,body jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 actor uuid:=auth.uid(); g uuid; sid uuid; before_batch uuid; after_batch uuid;
 fingerprint text; receipt app_private.financial_command_results; result jsonb;
 allowed text[]; field text; revision bigint; created uuid;
begin
 if actor is null or request_key is null or body is null or jsonb_typeof(body)<>'object' then raise exception 'Yêu cầu không hợp lệ';end if;
 case command_name
 when 'create_session' then allowed:=array['g','title_text','venue_text','start_time','deadline','already_played','people','court','be_collector']; g:=(body->>'g')::uuid;
 when 'add_expense' then allowed:=array['sid','expected_revision','title_text','raw_amount','payer','beneficiaries','mode','split','values_text','reason'];sid:=(body->>'sid')::uuid;
 when 'apply_financial_change' then allowed:=array['sid','expected_revision','action_name','body'];sid:=(body->>'sid')::uuid;
 when 'finish_session' then allowed:=array['sid','expected_revision','court'];sid:=(body->>'sid')::uuid;
 when 'claim_collector' then allowed:=array['sid','expected_revision','court'];sid:=(body->>'sid')::uuid;
 when 'payment_action' then allowed:=array['target','operation'];select session_id into sid from public.settlements where id=(body->>'target')::uuid;
 when 'decide_session_request' then allowed:=array['request_id','approve','expected_hash'];select session_id into sid from public.approval_requests where id=(body->>'request_id')::uuid;
 else raise exception 'Thao tác tiền không hợp lệ';
 end case;
 if not(body ?& allowed) or exists(select 1 from jsonb_object_keys(body) k where not(k=any(allowed))) then raise exception 'Thông tin yêu cầu không hợp lệ';end if;
 foreach field in array allowed loop
  if jsonb_typeof(body->field)='null' then raise exception 'Thông tin yêu cầu không hợp lệ';end if;
  if field in ('people','beneficiaries','values_text') then
   if jsonb_typeof(body->field)<>'array' then raise exception 'Thông tin yêu cầu không hợp lệ';end if;
  elsif field='body' then
   if jsonb_typeof(body->field)<>'object' then raise exception 'Thông tin yêu cầu không hợp lệ';end if;
  elsif field in ('already_played','be_collector','approve') then
   if jsonb_typeof(body->field)<>'boolean' then raise exception 'Thông tin yêu cầu không hợp lệ';end if;
  elsif field='expected_revision' then
   if jsonb_typeof(body->field) not in ('string','number') then raise exception 'Thông tin yêu cầu không hợp lệ';end if;
  elsif jsonb_typeof(body->field)<>'string' then raise exception 'Thông tin yêu cầu không hợp lệ';end if;
 end loop;
 if command_name<>'create_session' then select group_id into g from public.sessions where id=sid;end if;
 if g is null or not public.is_member(g) then raise exception 'Không có quyền';end if;
 -- The key is scoped to this actor across all commands. A successful retry is
 -- an acknowledgement of the original result, never a second execution.
 perform pg_advisory_xact_lock(hashtextextended('3t-financial-command:'||actor||':'||request_key,0));
 if not public.is_member(g) then raise exception 'Không có quyền';end if;
 fingerprint:=encode(sha256(convert_to(jsonb_build_object('command',command_name,'body',body)::text,'UTF8')),'hex');
 select * into receipt from app_private.financial_command_results r where r.actor_id=actor and r.request_key=execute_financial_command.request_key;
 if found then
  if receipt.payload_hash<>fingerprint or receipt.command_name<>execute_financial_command.command_name then raise exception 'Mã yêu cầu đã dùng cho nội dung khác';end if;
  return receipt.result||jsonb_build_object('replayed',true);
 end if;
 if sid is not null then select last_recalculation_id into before_batch from public.sessions where id=sid for update;end if;
 if body ? 'expected_revision' and coalesce(body->>'expected_revision','') !~ '^[0-9]+$' then raise exception 'Phiên bản buổi không hợp lệ';end if;
 case command_name
 when 'create_session' then
  if jsonb_typeof(body->'people')<>'array' or jsonb_typeof(body->'already_played')<>'boolean' or jsonb_typeof(body->'be_collector')<>'boolean' then raise exception 'Thông tin buổi không hợp lệ';end if;
  sid:=app_private.create_session(g,body->>'title_text',body->>'venue_text',(body->>'start_time')::timestamptz,(body->>'deadline')::timestamptz,(body->>'already_played')::boolean,array(select jsonb_array_elements_text(body->'people'))::uuid[],body->>'court',(body->>'be_collector')::boolean);created:=sid;
 when 'add_expense' then
  if jsonb_typeof(body->'beneficiaries')<>'array' or jsonb_typeof(body->'values_text')<>'array' then raise exception 'Khoản chi không hợp lệ';end if;
  perform app_private.add_expense(sid,(body->>'expected_revision')::bigint,body->>'title_text',body->>'raw_amount',(body->>'payer')::uuid,array(select jsonb_array_elements_text(body->'beneficiaries'))::uuid[],body->>'mode',body->>'split',array(select jsonb_array_elements_text(body->'values_text')),body->>'reason');
 when 'apply_financial_change' then
  if jsonb_typeof(body->'body')<>'object' then raise exception 'Thay đổi không hợp lệ';end if;
  perform app_private.apply_financial_change(sid,(body->>'expected_revision')::bigint,body->>'action_name',body->'body');
 when 'finish_session' then perform app_private.finish_session(sid,(body->>'expected_revision')::bigint,body->>'court');
 when 'claim_collector' then perform app_private.claim_collector(sid,(body->>'expected_revision')::bigint,body->>'court');
 when 'payment_action' then perform app_private.payment_action((body->>'target')::uuid,body->>'operation');
 when 'decide_session_request' then
  if jsonb_typeof(body->'approve')<>'boolean' then raise exception 'Quyết định không hợp lệ';end if;
  perform app_private.decide_session_request((body->>'request_id')::uuid,(body->>'approve')::boolean,body->>'expected_hash');
 end case;
 select s.revision,s.last_recalculation_id into revision,after_batch from public.sessions s where s.id=sid;
 result:=jsonb_build_object('id',created,'session_id',sid,'revision',revision::text,'batch_id',case when after_batch is distinct from before_batch then after_batch else null end);
 insert into app_private.financial_command_results(actor_id,request_key,command_name,payload_hash,group_id,session_id,result) values(actor,request_key,command_name,fingerprint,g,sid,result);
 return result||jsonb_build_object('replayed',false);
end $$;
revoke all on function public.execute_financial_command(text,uuid,jsonb) from public,anon,service_role;
grant execute on function public.execute_financial_command(text,uuid,jsonb) to authenticated;

-- Compatibility RPCs also pass through the command ledger. New clients supply an
-- explicit key to distinguish intentionally identical submissions. Legacy keys
-- are deterministic from the complete original payload, including its revision.
create function public.create_session(g uuid,title_text text,venue_text text,start_time timestamptz,deadline timestamptz,already_played boolean,people uuid[],court text,be_collector boolean) returns uuid language plpgsql security definer set search_path='' as $$
declare payload jsonb:=jsonb_build_object('g',g,'title_text',title_text,'venue_text',venue_text,'start_time',start_time,'deadline',deadline,'already_played',already_played,'people',people,'court',court,'be_collector',be_collector); response jsonb;
begin
 response:=public.execute_financial_command('create_session',md5('create_session:'||payload::text)::uuid,payload);
 return (response->>'id')::uuid;
end $$;
revoke all on function public.create_session(uuid,text,text,timestamptz,timestamptz,boolean,uuid[],text,boolean) from public,anon,service_role;
grant execute on function public.create_session(uuid,text,text,timestamptz,timestamptz,boolean,uuid[],text,boolean) to authenticated;
create function public.add_expense(sid uuid,expected_revision bigint,title_text text,raw_amount text,payer uuid,beneficiaries uuid[],mode text,split text,values_text text[],reason text default '') returns void language plpgsql security definer set search_path='' as $$
declare payload jsonb:=jsonb_build_object('sid',sid,'expected_revision',expected_revision,'title_text',title_text,'raw_amount',raw_amount,'payer',payer,'beneficiaries',beneficiaries,'mode',mode,'split',split,'values_text',values_text,'reason',reason); response jsonb;
begin
 response:=public.execute_financial_command('add_expense',md5('add_expense:'||payload::text)::uuid,payload);
 return;
end $$;
revoke all on function public.add_expense(uuid,bigint,text,text,uuid,uuid[],text,text,text[],text) from public,anon,service_role;
grant execute on function public.add_expense(uuid,bigint,text,text,uuid,uuid[],text,text,text[],text) to authenticated;
create function public.apply_financial_change(sid uuid,expected_revision bigint,action_name text,body jsonb) returns void language plpgsql security definer set search_path='' as $$
declare payload jsonb:=jsonb_build_object('sid',sid,'expected_revision',expected_revision,'action_name',action_name,'body',body); response jsonb;
begin
 response:=public.execute_financial_command('apply_financial_change',md5('apply_financial_change:'||payload::text)::uuid,payload);
 return;
end $$;
revoke all on function public.apply_financial_change(uuid,bigint,text,jsonb) from public,anon,service_role;
grant execute on function public.apply_financial_change(uuid,bigint,text,jsonb) to authenticated;
create function public.finish_session(sid uuid,expected_revision bigint,court text) returns void language plpgsql security definer set search_path='' as $$
declare payload jsonb:=jsonb_build_object('sid',sid,'expected_revision',expected_revision,'court',court); response jsonb;
begin
 response:=public.execute_financial_command('finish_session',md5('finish_session:'||payload::text)::uuid,payload);
 return;
end $$;
revoke all on function public.finish_session(uuid,bigint,text) from public,anon,service_role;
grant execute on function public.finish_session(uuid,bigint,text) to authenticated;
create function public.claim_collector(sid uuid,expected_revision bigint,court text) returns void language plpgsql security definer set search_path='' as $$
declare payload jsonb:=jsonb_build_object('sid',sid,'expected_revision',expected_revision,'court',court); response jsonb;
begin
 response:=public.execute_financial_command('claim_collector',md5('claim_collector:'||payload::text)::uuid,payload);
 return;
end $$;
revoke all on function public.claim_collector(uuid,bigint,text) from public,anon,service_role;
grant execute on function public.claim_collector(uuid,bigint,text) to authenticated;
create function public.payment_action(target uuid,operation text) returns void language plpgsql security definer set search_path='' as $$
declare payload jsonb:=jsonb_build_object('target',target,'operation',operation); response jsonb;
begin
 response:=public.execute_financial_command('payment_action',md5('payment_action:'||payload::text)::uuid,payload);
 return;
end $$;
revoke all on function public.payment_action(uuid,text) from public,anon,service_role;
grant execute on function public.payment_action(uuid,text) to authenticated;
create function public.decide_session_request(request_id uuid,approve boolean,expected_hash text) returns void language plpgsql security definer set search_path='' as $$
declare payload jsonb:=jsonb_build_object('request_id',request_id,'approve',approve,'expected_hash',expected_hash); response jsonb;
begin
 response:=public.execute_financial_command('decide_session_request',md5('decide_session_request:'||payload::text)::uuid,payload);
 return;
end $$;
revoke all on function public.decide_session_request(uuid,boolean,text) from public,anon,service_role;
grant execute on function public.decide_session_request(uuid,boolean,text) to authenticated;

create or replace function public.preview_financial_change(sid uuid,expected_revision bigint,action_name text,body jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 begin
 perform app_private.apply_financial_change(sid,expected_revision,action_name,body);
 result:=public.session_details(sid);
 raise exception using errcode='PT001',message='rollback preview';
 exception when sqlstate 'PT001' then null;
 end;
 return result;
end $$;


create or replace function app_private.decide_session_request(request_id uuid,approve boolean,expected_hash text) returns void language plpgsql security definer set search_path='' as $$
declare r public.approval_requests;s public.sessions;actor uuid;candidate uuid;target uuid;op text;eid uuid;
begin
 select * into r from public.approval_requests where id=request_id;
 if r.session_id is null then raise exception 'Yêu cầu không hợp lệ';end if;
 select * into s from public.sessions where id=r.session_id for update;
 select * into r from public.approval_requests where id=request_id for update;
 if not public.is_member(s.group_id) then raise exception 'Không có quyền';end if;
 select id into actor from public.group_members where group_id=s.group_id and user_id=auth.uid() and status='active';
 if r.status<>'pending' or r.expires_at<=now() or r.payload_hash<>expected_hash or r.payload_hash<>encode(sha256(convert_to(r.payload::text,'UTF8')),'hex') then raise exception 'Yêu cầu đã thay đổi hoặc hết hạn';end if;
 if actor::text is distinct from r.required_authority or (r.type<>'collector_nomination' and actor is distinct from s.collector_member_id) then raise exception 'Bạn không phải người có thẩm quyền';end if;
 if approve is null then raise exception 'Quyết định không hợp lệ';end if;
 if approve then
 if r.session_revision<>s.revision or s.status='cancelled' or (s.status='settled' and s.settled_at<now()-interval '30 days') then raise exception 'Buổi đã thay đổi hoặc đã khóa. Cần gửi yêu cầu mới';end if;
 if r.type='expense_proposal' then
 eid:=(r.payload->>'expense_id')::uuid;
 perform public.write_expense_internal(s.id,s.revision,r.payload->>'title',r.payload->>'amount',(r.payload->>'payer')::uuid,array(select jsonb_array_elements_text(r.payload->'beneficiaries')::uuid),r.payload->>'mode',r.payload->>'split',array(select jsonb_array_elements_text(r.payload->'values')),r.payload->>'reason',eid);
 elsif r.type in ('join','leave','weight') then
 target:=(r.payload->>'member_id')::uuid;
 if not exists(select 1 from public.group_members where id=target and group_id=s.group_id and user_id=r.requested_by and status='active') then raise exception 'Người yêu cầu đã thay đổi';end if;
 op:=case when r.type='join' then 'add' when r.type='leave' then 'remove' else 'weight' end;
 if s.status='planned' then
 if op='add' then insert into public.session_attendees(session_id,member_id,rsvp,committed_at,commit_source) values(s.id,target,'going',now(),'added_by_collector') on conflict(session_id,member_id) do update set rsvp='going',committed_at=now(),removed_at=null,commit_source='added_by_collector';
 elsif op='remove' then update public.session_attendees set removed_at=now(),removed_by=auth.uid(),removal_reason=r.payload->>'reason' where session_id=s.id and member_id=target;
 else update public.session_attendees set weight=(r.payload->>'weight')::numeric where session_id=s.id and member_id=target;end if;
 insert into public.attendance_events(session_id,member_id,actor_id,action,reason,session_status_at_time) values(s.id,target,auth.uid(),r.type||'_approved',r.payload->>'reason',s.status);
 update public.sessions set revision=revision+1 where id=s.id;
 else perform app_private.apply_financial_change(s.id,s.revision,'attendee',r.payload||jsonb_build_object('operation',op));end if;
 elsif r.type='collector_nomination' then
 candidate:=(r.payload->>'member_id')::uuid;
 if r.payload->>'phase'='consent' then
 if actor is distinct from s.collector_member_id then raise exception 'Người tính tiền đã thay đổi';end if;
 update public.approval_requests set payload=payload||'{"phase":"accept"}',required_authority=candidate::text where id=r.id;
 update public.approval_requests set payload_hash=encode(sha256(convert_to(payload::text,'UTF8')),'hex') where id=r.id;
 insert into public.audit_log(group_id,session_id,actor_id,action,payload) values(s.group_id,s.id,auth.uid(),'collector_transfer_consented',jsonb_build_object('request_id',r.id));return;
 end if;
 if actor<>candidate or not exists(select 1 from public.group_members m join public.profiles p on p.id=m.user_id where m.id=candidate and m.group_id=s.group_id and m.status='active' and coalesce(p.bank_bin,'')<>'' and coalesce(p.bank_account_no,'')<>'') then raise exception 'Người nhận vai trò cần tài khoản và thông tin ngân hàng';end if;
 update public.sessions set collector_member_id=candidate,collector_nominee_member_id=null where id=s.id;
 update public.expenses set paid_by=candidate where session_id=s.id and kind='court' and status='active';
 if s.status in ('played','settled') then perform public.recalculate_session(s.id,r.payload->>'reason');else update public.sessions set revision=revision+1 where id=s.id;end if;
 else raise exception 'Loại yêu cầu chưa được hỗ trợ';end if;
 else
 if r.type='expense_proposal' then update public.expenses set status='rejected' where id=(r.payload->>'expense_id')::uuid and status='proposed';end if;
 if r.type='collector_nomination' then update public.sessions set collector_nominee_member_id=null where id=s.id and collector_nominee_member_id=(r.payload->>'member_id')::uuid;end if;
 end if;
 update public.approval_requests set status=case when approve then 'approved' else 'rejected' end,decided_by=auth.uid(),decided_at=now() where id=r.id;
 insert into public.audit_log(group_id,session_id,actor_id,action,payload) values(s.group_id,s.id,auth.uid(),case when approve then 'approval_approved' else 'approval_rejected' end,jsonb_build_object('request_id',r.id,'type',r.type,'requested_by',r.requested_by,'reason',r.payload->>'reason'));
end $$;


create or replace function public.preview_session_request(request_id uuid,expected_hash text) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;sid uuid;
begin
 select session_id into sid from public.approval_requests where id=request_id;
 begin
 perform app_private.decide_session_request(request_id,true,expected_hash);
 result:=public.session_details(sid);
 raise exception using errcode='PT003',message='approval preview';
 exception when sqlstate 'PT003' then null;end;
 return result;
end $$;
revoke all on function public.preview_session_request(uuid,text) from public,anon;
grant execute on function public.preview_session_request(uuid,text) to authenticated;


create or replace function public.close_poll(target uuid,chosen uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare p public.polls;o public.poll_options;sid uuid;
begin
 select * into p from public.polls where id=target for update;
 if not found or not public.is_member(p.group_id) or (p.created_by<>auth.uid() and not public.is_group_admin(p.group_id)) then raise exception 'Chỉ người tạo thăm dò hoặc admin được chốt';end if;
 if p.status='closed' then return p.resulting_session_id;end if;
 select * into o from public.poll_options where id=chosen and poll_id=target;
 if not found or o.starts_at<=now() then raise exception 'Khung giờ không hợp lệ';end if;
 if (select count(*) from public.poll_votes v join public.group_members m on m.id=v.member_id where v.option_id=chosen and v.answer='yes' and m.status='active' and m.group_id=p.group_id)<p.min_attendees then raise exception 'Chưa đủ số người tối thiểu';end if;
 sid:=app_private.create_session(p.group_id,p.title,p.venue,o.starts_at,o.starts_at,false,'{}','0',false);
 insert into public.session_attendees(session_id,member_id,rsvp) select sid,v.member_id,case when v.answer='yes' then 'going' else 'maybe' end from public.poll_votes v join public.group_members m on m.id=v.member_id where v.option_id=chosen and v.answer in ('yes','maybe') and m.status='active';
 update public.polls set status='closed',resulting_session_id=sid where id=target;
 perform public.notify_group(p.group_id,'poll-closed:'||target,'Đã chốt lịch: '||p.title||'. Mỗi người nhớ tự chốt tham gia.','/sessions/'||sid);
 insert into public.audit_log(group_id,session_id,actor_id,action,payload) values(p.group_id,sid,auth.uid(),'poll_closed',jsonb_build_object('poll_id',target,'option_id',chosen));return sid;
end $$;

