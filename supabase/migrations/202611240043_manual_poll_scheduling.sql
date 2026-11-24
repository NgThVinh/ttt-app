-- Poll results only prefill a form. Session creation remains an explicit action.
create function public.finish_poll(target uuid) returns void language plpgsql security definer set search_path='' as $$
declare p public.polls;
begin
 select * into p from public.polls where id=target for update;
 if not found or not public.is_member(p.group_id) or (p.created_by<>auth.uid() and not public.is_group_admin(p.group_id)) then raise exception 'Chỉ người tạo hoặc admin được đóng thăm dò';end if;
 if p.status='closed' then return;end if;
 update public.polls set status='closed' where id=target;
 insert into public.audit_log(group_id,actor_id,action,payload) values(p.group_id,auth.uid(),'poll_voting_closed',jsonb_build_object('poll_id',target));
end $$;
revoke all on function public.finish_poll(uuid) from public,anon,service_role;
grant execute on function public.finish_poll(uuid) to authenticated;

create function public.schedule_poll_meeting(request_key uuid,target_poll uuid,chosen_option uuid,body jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare p public.polls; fingerprint text; receipt app_private.financial_command_results; result jsonb; sid uuid;
begin
 if auth.uid() is null or request_key is null or target_poll is null or chosen_option is null or body is null or jsonb_typeof(body)<>'object' then raise exception 'Thông tin thăm dò không hợp lệ';end if;
 select * into p from public.polls where id=target_poll;
 if not found or not public.is_member(p.group_id) or (body->>'g')::uuid is distinct from p.group_id then raise exception 'Không có quyền với thăm dò';end if;
 perform pg_advisory_xact_lock(hashtextextended('3t-financial-command:'||auth.uid()||':'||request_key,0));
 fingerprint:=encode(sha256(convert_to(jsonb_build_object('poll',target_poll,'option',chosen_option,'body',body)::text,'UTF8')),'hex');
 select * into receipt from app_private.financial_command_results r where r.actor_id=auth.uid() and r.request_key=schedule_poll_meeting.request_key;
 if found then
  if receipt.command_name<>'schedule_poll_meeting' or receipt.payload_hash<>fingerprint then raise exception 'Mã yêu cầu đã dùng cho nội dung khác';end if;
  if not public.is_member(receipt.group_id) then raise exception 'Không có quyền';end if;
  return receipt.result||jsonb_build_object('replayed',true);
 end if;
 select * into p from public.polls where id=target_poll for update;
 if not public.is_member(p.group_id) then raise exception 'Không có quyền';end if;
 if p.resulting_session_id is not null then raise exception 'Thăm dò đã có buổi chơi. Hãy mở buổi đã tạo';end if;
 if not exists(select 1 from public.poll_options where id=chosen_option and poll_id=p.id and starts_at>now()) then raise exception 'Khung giờ không thuộc thăm dò hoặc đã qua';end if;
 result:=public.schedule_meeting(md5('poll-meeting:'||request_key::text)::uuid,body);
 if (result->>'replayed')::boolean then raise exception 'Mã yêu cầu đã dùng; hãy mở lại form';end if;
 sid:=(result->>'id')::uuid;
 update public.polls set status='closed',resulting_session_id=sid where id=p.id;
 insert into public.audit_log(group_id,session_id,actor_id,action,payload) values(p.group_id,sid,auth.uid(),'poll_meeting_created',jsonb_build_object('poll_id',p.id,'option_id',chosen_option));
 perform public.notify_group(p.group_id,'poll-manual-session:'||p.id,'Đã tạo buổi từ thăm dò: '||p.title||'. Hãy tự nhận lời tham gia.','/sessions/'||sid);
 insert into app_private.financial_command_results(actor_id,request_key,command_name,payload_hash,group_id,session_id,result) values(auth.uid(),request_key,'schedule_poll_meeting',fingerprint,p.group_id,sid,result);
 return result||jsonb_build_object('replayed',false);
end $$;
revoke all on function public.schedule_poll_meeting(uuid,uuid,uuid,jsonb) from public,anon,service_role;
grant execute on function public.schedule_poll_meeting(uuid,uuid,uuid,jsonb) to authenticated;

-- Existing links may still read their result; the legacy RPC no longer creates sessions.
create or replace function public.close_poll(target uuid,chosen uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare p public.polls;
begin
 select * into p from public.polls where id=target;
 if not found or not public.is_member(p.group_id) then raise exception 'Không có quyền';end if;
 if p.resulting_session_id is not null then return p.resulting_session_id;end if;
 raise exception 'Hãy mở form tạo buổi từ thăm dò và xác nhận lưu';
end $$;
