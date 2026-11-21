create function public.write_expense_internal(sid uuid,expected_revision bigint,title_text text,raw_amount text,payer uuid,beneficiaries uuid[],mode text,split text,values_text text[],reason text default '',activate_id uuid default null) returns void language plpgsql security definer set search_path='' as $$
declare s public.sessions; eid uuid; total bigint; i integer; ratio numeric; sum_ratio numeric:=0;
begin
 select * into s from public.sessions where id=sid for update;
 if not found or not public.is_member(s.group_id) then raise exception 'Chỉ người tính tiền được nhập khoản chi';end if;
 if s.revision<>expected_revision then raise exception 'Buổi đã thay đổi. Vui lòng tải lại để xem trước';end if;
 if s.status='cancelled' or (s.status='settled' and s.settled_at<now()-interval '30 days') then raise exception 'Buổi đã khóa';end if;
 if s.status='planned' then raise exception 'Hoàn tất buổi trước khi nhập chi phí';end if;
 if exists(select 1 from public.settlements where session_id=sid) and coalesce(length(trim(reason)),0) not between 1 and 500 then raise exception 'Cần lý do thay đổi sau khi đã có khoản thu';end if;
 if length(trim(title_text)) not between 1 and 160 or cardinality(beneficiaries) not between 1 and 100 or cardinality(beneficiaries)<>(select count(distinct x) from unnest(beneficiaries) x) or mode not in ('total','per_person') or split not in ('equal','weighted','exact','percent') then raise exception 'Khoản chi không hợp lệ';end if;
 if activate_id is null and (select count(*) from public.expenses where session_id=sid and status in ('active','proposed'))>=200 then raise exception 'Tối đa 200 khoản chi';end if;
 if not exists(select 1 from public.session_attendees where session_id=sid and member_id=payer and rsvp='going' and removed_at is null) or exists(select 1 from unnest(beneficiaries) x where not exists(select 1 from public.session_attendees where session_id=sid and member_id=x and rsvp='going' and removed_at is null)) then raise exception 'Người ứng và người chịu phải tham gia buổi';end if;
 total:=raw_amount::bigint;if abs(total::numeric)>1000000000000 then raise exception 'Số tiền vượt giới hạn';end if;if mode='per_person' then total:=total*cardinality(beneficiaries);end if;
 if split in ('exact','percent') and cardinality(values_text)<>cardinality(beneficiaries) then raise exception 'Nhập đủ các phần chia';end if;
 if activate_id is null then insert into public.expenses(session_id,title,amount,paid_by,created_by,amount_mode,split_mode,unit_amount) values(sid,trim(title_text),total,payer,auth.uid(),mode,split,case when mode='per_person' then raw_amount::bigint else null end) returning id into eid; else update public.expenses set status='active',amount=total,title=trim(title_text),paid_by=payer,amount_mode=mode,split_mode=split,unit_amount=case when mode='per_person' then raw_amount::bigint else null end where id=activate_id and session_id=sid and status='proposed' returning id into eid; if not found then raise exception 'Đề xuất đã thay đổi';end if;end if;
 for i in 1..cardinality(beneficiaries) loop
 ratio:=case when split='equal' then 1 when split='weighted' then (select weight from public.session_attendees where session_id=sid and member_id=beneficiaries[i]) else values_text[i]::numeric end;
 if ratio<0 or ratio<>round(ratio,6) or ratio>100000000000000 then raise exception 'Phần chia không hợp lệ';end if;
 sum_ratio:=sum_ratio+ratio;
 insert into public.expense_split_inputs values(eid,beneficiaries[i],ratio,now());
 end loop;
 if (split='percent' and sum_ratio<>100) or (split='exact' and sum_ratio<>abs(total::numeric)) then raise exception 'Tổng phần chia không khớp';end if;
 if sum_ratio=0 then update public.expense_split_inputs set weight=1 where expense_id=eid;end if;
 perform public.recalculate_session(sid,reason);
end $$;
revoke all on function public.write_expense_internal(uuid,bigint,text,text,uuid,uuid[],text,text,text[],text,uuid) from public,anon,authenticated;

alter table public.approval_requests add column session_revision bigint;
alter table public.expenses add column approval_request_id uuid references public.approval_requests;
alter table public.sessions add column collector_nominee_member_id uuid references public.group_members;
create unique index one_session_request on public.approval_requests(session_id,type,requested_by) where session_id is not null and status='pending' and type<>'expense_proposal';

create function public.new_session_request(sid uuid,kind text,body jsonb,authority text) returns uuid language plpgsql security definer set search_path='' as $$
declare s public.sessions;rid uuid;
begin
 select * into s from public.sessions where id=sid for update;
 if not public.is_member(s.group_id) then raise exception 'Không có quyền';end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,0));
 if (select count(*) from public.approval_requests where requested_by=auth.uid() and created_at>now()-interval '24 hours')>=20 then raise exception 'Tối đa 20 yêu cầu mỗi ngày';end if;
 update public.approval_requests set status='expired' where session_id=sid and requested_by=auth.uid() and type=kind and status='pending' and expires_at<=now();
 insert into public.approval_requests(group_id,session_id,type,payload,payload_hash,required_authority,requested_by,session_revision)
 values(s.group_id,sid,kind,body,encode(sha256(convert_to(body::text,'UTF8')),'hex'),authority,auth.uid(),s.revision) returning id into rid;
 insert into public.audit_log(group_id,session_id,actor_id,action,payload) values(s.group_id,sid,auth.uid(),'approval_requested',jsonb_build_object('request_id',rid,'type',kind,'reason',body->>'reason'));
 return rid;
end $$;
revoke all on function public.new_session_request(uuid,text,jsonb,text) from public,anon,authenticated;

create or replace function public.add_expense(sid uuid,expected_revision bigint,title_text text,raw_amount text,payer uuid,beneficiaries uuid[],mode text,split text,values_text text[],reason text default '') returns void language plpgsql security definer set search_path='' as $$
declare s public.sessions;actor uuid;eid uuid;rid uuid;body jsonb;total bigint;
begin
 select * into s from public.sessions where id=sid for update;
 if not found or not public.is_member(s.group_id) then raise exception 'Không có quyền';end if;
 update public.expenses set status='rejected' where status='proposed' and session_id=sid and approval_request_id in(select id from public.approval_requests where session_id=sid and status='pending' and expires_at<=now());
 update public.approval_requests set status='expired' where session_id=sid and status='pending' and expires_at<=now();
 select id into actor from public.group_members where group_id=s.group_id and user_id=auth.uid() and status='active';
 if actor=s.collector_member_id or (cardinality(beneficiaries)=1 and beneficiaries[1]=actor and exists(select 1 from public.session_attendees where session_id=sid and member_id=actor and rsvp='going' and removed_at is null)) then
 perform public.write_expense_internal(sid,expected_revision,title_text,raw_amount,payer,beneficiaries,mode,split,values_text,reason);return;
 end if;
 if not exists(select 1 from public.session_attendees where session_id=sid and member_id=actor and rsvp='going' and removed_at is null) then raise exception 'Chỉ người tham gia được đề xuất';end if;
 -- Validate with the same writer, then roll back the speculative financial changes.
 begin
 perform public.write_expense_internal(sid,expected_revision,title_text,raw_amount,payer,beneficiaries,mode,split,values_text,reason);
 raise exception using errcode='PT002',message='validation only';
 exception when sqlstate 'PT002' then null;end;
 total:=raw_amount::bigint*case when mode='per_person' then cardinality(beneficiaries) else 1 end;
 insert into public.expenses(session_id,title,amount,paid_by,created_by,amount_mode,split_mode,unit_amount,status)
 values(sid,title_text,total,payer,auth.uid(),mode,split,case when mode='per_person' then raw_amount::bigint else null end,'proposed') returning id into eid;
 body:=jsonb_build_object('expense_id',eid,'title',title_text,'amount',raw_amount,'payer',payer,'beneficiaries',beneficiaries,'mode',mode,'split',split,'values',values_text,'reason',reason);
 rid:=public.new_session_request(sid,'expense_proposal',body,s.collector_member_id::text);
 update public.expenses set approval_request_id=rid where id=eid;
end $$;

create function public.request_session_change(sid uuid,kind text,body jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare s public.sessions;actor uuid;canonical jsonb;candidate uuid;authority uuid;
begin
 select * into s from public.sessions where id=sid for update;
 if not found or not public.is_member(s.group_id) then raise exception 'Không có quyền';end if;
 if kind is null or kind not in ('join','leave','weight','collector_nomination') or length(trim(coalesce(body->>'reason',''))) not between 1 and 500 then raise exception 'Yêu cầu không hợp lệ';end if;
 if s.status='cancelled' or (s.status='settled' and s.settled_at<now()-interval '30 days') then raise exception 'Buổi đã khóa';end if;
 select id into actor from public.group_members where group_id=s.group_id and user_id=auth.uid() and status='active';
 authority:=s.collector_member_id;
 if kind='collector_nomination' then
 if s.created_by<>auth.uid() and actor is distinct from s.collector_member_id then raise exception 'Chỉ người tạo hoặc người tính tiền được đề cử';end if;
 candidate:=(body->>'member_id')::uuid;
 if not exists(select 1 from public.group_members where id=candidate and group_id=s.group_id and status='active' and user_id is not null) or candidate=s.collector_member_id then raise exception 'Người được đề cử không hợp lệ';end if;
 canonical:=jsonb_build_object('member_id',candidate,'reason',trim(body->>'reason'),'phase',case when s.collector_member_id is not null and actor<>s.collector_member_id then 'consent' else 'accept' end);
 if canonical->>'phase'='accept' then authority:=candidate;end if;
 if exists(select 1 from public.approval_requests where session_id=sid and type='collector_nomination' and status='pending' and expires_at>now()) then raise exception 'Đang có đề cử chờ xử lý';end if;
 update public.sessions set collector_nominee_member_id=candidate where id=sid;
 else
 if authority is null then raise exception 'Cần có người tính tiền trước';end if;
 if kind in ('join','leave') and now()<s.commit_deadline then raise exception 'Trước hạn, hãy tự chốt đi hoặc không đi';end if;
 if kind in ('leave','weight') and not exists(select 1 from public.session_attendees where session_id=sid and member_id=actor and rsvp='going' and removed_at is null) then raise exception 'Bạn chưa tham gia';end if;
 if kind='join' and exists(select 1 from public.session_attendees where session_id=sid and member_id=actor and rsvp='going' and removed_at is null) then raise exception 'Bạn đã tham gia';end if;
 canonical:=jsonb_build_object('member_id',actor,'reason',trim(body->>'reason'));
 if kind='weight' then
 if (body->>'weight')::numeric<=0 or (body->>'weight')::numeric>100 or (body->>'weight')::numeric<>round((body->>'weight')::numeric,6) or body->>'weight' is null then raise exception 'Hệ số không hợp lệ';end if;
 canonical:=canonical||jsonb_build_object('weight',body->>'weight');end if;
 end if;
 return public.new_session_request(sid,kind,canonical,authority::text);
end $$;

create function public.decide_session_request(request_id uuid,approve boolean,expected_hash text) returns void language plpgsql security definer set search_path='' as $$
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
 else perform public.apply_financial_change(s.id,s.revision,'attendee',r.payload||jsonb_build_object('operation',op));end if;
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
create function public.cancel_session_request(request_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare r public.approval_requests;
begin
 select * into r from public.approval_requests where id=request_id;
 if r.requested_by is distinct from auth.uid() or not public.is_member(r.group_id) then raise exception 'Không có quyền';end if;
 perform 1 from public.sessions where id=r.session_id for update;
 update public.approval_requests set status='cancelled' where id=request_id and status='pending';
 if not found then raise exception 'Yêu cầu đã xử lý';end if;
 if r.type='expense_proposal' then update public.expenses set status='deleted',deleted_at=now(),deleted_by=auth.uid(),deleted_reason='Người đề xuất hủy' where id=(r.payload->>'expense_id')::uuid and status='proposed';end if;
 if r.type='collector_nomination' then update public.sessions set collector_nominee_member_id=null where id=r.session_id and collector_nominee_member_id=(r.payload->>'member_id')::uuid;end if;
 insert into public.audit_log(group_id,session_id,actor_id,action,payload) values(r.group_id,r.session_id,auth.uid(),'approval_cancelled',jsonb_build_object('request_id',r.id,'type',r.type));
end $$;
revoke all on function public.request_session_change(uuid,text,jsonb),public.decide_session_request(uuid,boolean,text),public.cancel_session_request(uuid) from public,anon;
grant execute on function public.request_session_change(uuid,text,jsonb),public.decide_session_request(uuid,boolean,text),public.cancel_session_request(uuid) to authenticated;

create function public.preview_session_request(request_id uuid,expected_hash text) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;sid uuid;
begin
 select session_id into sid from public.approval_requests where id=request_id;
 begin
 perform public.decide_session_request(request_id,true,expected_hash);
 result:=public.session_details(sid);
 raise exception using errcode='PT003',message='approval preview';
 exception when sqlstate 'PT003' then null;end;
 return result;
end $$;
revoke all on function public.preview_session_request(uuid,text) from public,anon;
grant execute on function public.preview_session_request(uuid,text) to authenticated;
