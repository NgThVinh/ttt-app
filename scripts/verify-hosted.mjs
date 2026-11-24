import pg from "pg";
import { databaseUrlForProject } from "./migration-utils.mjs";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
const connectionString = databaseUrlForProject(
  process.env.SUPABASE_DB_URL,
  process.env.NEXT_PUBLIC_SUPABASE_URL,
);
const db = new pg.Client({
  connectionString,
  ssl: {
    ca: readFileSync("supabase/certs/prod-ca-2021.crt", "utf8"),
    rejectUnauthorized: true,
  },
  connectionTimeoutMillis: 15000,
  query_timeout: 30000,
});
let stage = "connect";
let transaction = false;
const passed = [];
function assert(condition, label) {
  if (!condition)
    throw Object.assign(new Error(), { code: "ASSERTION_FAILED", label });
  passed.push(label);
}
async function actor(id) {
  await db.query("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,true)", [id]);
  await db.query("select set_config('request.jwt.claims',$1,true)", [
    JSON.stringify({ sub: id, role: "authenticated" }),
  ]);
  await db.query("set local role authenticated");
}
async function denied(sql, args) {
  await db.query("savepoint denied");
  let rejected = false;
  try {
    await db.query(sql, args);
  } catch {
    rejected = true;
    await db.query("rollback to savepoint denied");
  }
  await db.query("release savepoint denied");
  return rejected;
}
async function counts() {
  const result = {};
  for (const table of [
    "groups",
    "group_members",
    "sessions",
    "expenses",
    "settlements",
    "profiles",
    "audit_log",
    "approval_requests",
    "attendance_events",
    "polls",
    "poll_options",
    "poll_votes",
    "notifications",
    "weekly_series",
    "payment_evidence",
    "expense_receipts",
    "storage_cleanup_jobs",
    "session_recalculations",
    "guest_bank_accounts",
    "group_expense_categories",
    "expense_templates",
  ])
    result[table] = (
      await db.query(`select count(*)::text n from public.${table}`)
    ).rows[0].n;
  for (const table of [
    "super_admin_allowlist",
    "group_creation_requests",
    "financial_command_results",
    "admin_execution_context",
  ])
    result[`private:${table}`] = (
      await db.query(`select count(*)::text n from app_private.${table}`)
    ).rows[0].n;
  return result;
}
try {
  await db.connect();
  const before = await counts();
  const adminFingerprint = async () =>
    (
      await db.query(
        "select md5(coalesce(string_agg(email||':'||active::text,',' order by email),'')) state from app_private.super_admin_allowlist",
      )
    ).rows[0].state;
  const adminsBefore = await adminFingerprint();
  const authBefore = (await db.query("select count(*)::text n from auth.users"))
    .rows[0].n;
  const users = (
    await db.query(
      "select id from auth.users where email_confirmed_at is not null order by created_at limit 2",
    )
  ).rows;
  if (users.length < 2)
    throw Object.assign(new Error(), {
      code: "NEED_TWO_VERIFIED_TEST_IDENTITIES",
    });
  const [a, b] = users.map((x) => x.id);
  await db.query("begin");
  transaction = true;
  await db.query("set local lock_timeout='5s'");
  stage = "roles";
  const g = (
    await db.query(
      "select public.provision_group($1,'3T rollback smoke test','Badminton') id",
      [a],
    )
  ).rows[0].id;
  stage = "super admin";
  await db.query(
    "insert into app_private.super_admin_allowlist(email,active) select lower(trim(email)),true from auth.users where id=$1 on conflict(email) do update set active=true",
    [a],
  );
  await db.query(
    "update app_private.super_admin_allowlist set active=false where email=(select lower(trim(email)) from auth.users where id=$1)",
    [b],
  );
  await actor(b);
  assert(
    !(await db.query("select public.is_super_admin() ok")).rows[0].ok,
    "hosted ordinary identity is not super admin",
  );
  assert(
    await denied("select public.create_group('Forbidden','Sport',$1)", [
      randomUUID(),
    ]),
    "hosted allowlist blocks normal group creation",
  );
  assert(
    await denied("select email from app_private.super_admin_allowlist"),
    "hosted client cannot read admin allowlist",
  );
  await actor(a);
  assert(
    (await db.query("select public.is_super_admin() ok")).rows[0].ok,
    "hosted verified allowlisted identity recognized",
  );
  const creationKey = randomUUID();
  const createdGroup = (
    await db.query(
      "select public.create_group('Rollback retry group','Sport',$1) id",
      [creationKey],
    )
  ).rows[0].id;
  assert(
    (
      await db.query(
        "select public.create_group('Rollback retry group','Sport',$1) id",
        [creationKey],
      )
    ).rows[0].id === createdGroup,
    "hosted group creation retries return original group",
  );
  assert(
    await denied("select public.create_group('Changed retry','Sport',$1)", [
      creationKey,
    ]),
    "hosted changed idempotent payload rejected",
  );
  assert(
    (
      await db.query(
        "select id from public.audit_log where group_id=$1 and action='group_created'",
        [createdGroup],
      )
    ).rowCount === 1,
    "hosted retry creates only one audit event",
  );
  const inviteHash = randomUUID().replaceAll("-", "").repeat(2);
  const finalInvite = (
    await db.query(
      "select public.create_invite($1,$2,now()+interval '1 day',1) id",
      [createdGroup, inviteHash],
    )
  ).rows[0].id;
  await actor(b);
  await db.query("select public.accept_invite($1,'Rollback B')", [inviteHash]);
  await db.query("select public.accept_invite($1,'Rollback retry')", [
    inviteHash,
  ]);
  await actor(a);
  assert(
    (
      await db.query("select uses from public.invites where id=$1", [
        finalInvite,
      ])
    ).rows[0].uses === 1,
    "hosted last-slot invitation retry consumes no extra use",
  );
  await db.query("select public.revoke_invite($1)", [finalInvite]);
  await actor(b);
  assert(
    await denied("select public.accept_invite($1,'Revoked retry')", [
      inviteHash,
    ]),
    "hosted invitation retry cannot bypass revocation",
  );
  await db.query("reset role");
  const guestMember = (
    await db.query(
      "insert into public.group_members(group_id,display_name) values($1,'Rollback guest') returning id",
      [createdGroup],
    )
  ).rows[0].id;
  await actor(a);
  await db.query(
    "select public.set_guest_bank($1,'970415','12345678','TEST GUEST','Rollback bank fixture')",
    [guestMember],
  );
  await actor(b);
  assert(
    (
      await db.query(
        "select member_id from public.guest_bank_accounts where member_id=$1",
        [guestMember],
      )
    ).rowCount === 1,
    "hosted group member can read guest bank",
  );
  assert(
    await denied(
      "select public.set_guest_bank($1,'970415','99999999','FORBIDDEN','Must deny')",
      [guestMember],
    ),
    "hosted ordinary member cannot change guest bank",
  );
  await db.query("select public.request_member_claim($1)", [guestMember]);
  const guestClaim = (
    await db.query(
      "select id from public.approval_requests where group_id=$1 and type='member_claim' and status='pending'",
      [createdGroup],
    )
  ).rows[0].id;
  await actor(a);
  await db.query("select public.decide_member_claim($1,true)", [guestClaim]);
  assert(
    (
      await db.query(
        "select member_id from public.guest_bank_accounts where member_id=$1",
        [guestMember],
      )
    ).rowCount === 0,
    "hosted linked member no longer exposes guest bank fallback",
  );
  assert(
    await denied(
      "select public.set_guest_bank($1,'970415','99999999','FORBIDDEN','Linked user owns bank')",
      [guestMember],
    ),
    "hosted admin cannot override linked member bank",
  );
  await actor(b);
  await db.query(
    "insert into public.profiles(id,display_name,bank_bin,bank_account_no,bank_account_name) values($1,'Rollback B','970415','87654321','TEST B') on conflict(id) do update set bank_bin='970415',bank_account_no='87654321',bank_account_name='TEST B'",
    [b],
  );
  const groupAdminMember = (
    await db.query(
      "select id from public.group_members where group_id=$1 and user_id=$2",
      [createdGroup, a],
    )
  ).rows[0].id;
  const fallbackSession = (
    await db.query(
      "select public.create_session($1,'Rollback fallback','Court',now()-interval '1 hour',now()-interval '1 hour',true,$2,'100000',true) id",
      [createdGroup, [groupAdminMember, guestMember]],
    )
  ).rows[0].id;
  await actor(a);
  const agedRequest = (
    await db.query("select public.request_session_change($1,'weight',$2) id", [
      fallbackSession,
      { weight: "0.5", reason: "Rollback half session" },
    ])
  ).rows[0].id;
  assert(
    await denied(
      "select public.preview_admin_financial($1,1,'apply_request','{}','Too early',$2)",
      [fallbackSession, agedRequest],
    ),
    "hosted admin fallback cannot bypass a responsive collector",
  );
  await db.query("reset role");
  await db.query(
    "update public.approval_requests set created_at=now()-interval '73 hours',expires_at=now()-interval '1 hour' where id=$1",
    [agedRequest],
  );
  await actor(a);
  const fallbackDraft = (
    await db.query(
      "select public.preview_admin_financial($1,1,'apply_request','{}','Current rollback review',$2) p",
      [fallbackSession, agedRequest],
    )
  ).rows[0].p;
  assert(
    (
      await db.query(
        "select weight::text w from public.session_attendees where session_id=$1 and member_id=$2",
        [fallbackSession, groupAdminMember],
      )
    ).rows[0].w === "1",
    "hosted fallback preview changes no real allocation",
  );
  await db.query("select public.apply_admin_financial($1,$2)", [
    fallbackDraft.id,
    fallbackDraft.hash,
  ]);
  assert(
    (
      await db.query(
        "select status from public.approval_requests where id=$1",
        [agedRequest],
      )
    ).rows[0].status === "expired",
    "hosted fallback never revives expired source request",
  );
  assert(
    (
      await db.query(
        "select id from public.approval_requests where session_id=$1 and payload->>'source_request_id'=$2 and status='approved'",
        [fallbackSession, agedRequest],
      )
    ).rowCount === 1,
    "hosted fallback approves a fresh reviewed request",
  );
  const catalog = (
    await db.query("select public.expense_tools($1) t", [createdGroup])
  ).rows[0].t;
  assert(
    catalog.categories.length === 7 && catalog.templates.length === 2,
    "hosted new groups receive default categories and templates",
  );
  assert(
    catalog.templates.every((t) => typeof t.amount === "string"),
    "hosted template amounts are decimal strings",
  );
  await actor(b);
  const editorRevision = (
    await db.query("select revision::text r from public.sessions where id=$1", [
      fallbackSession,
    ])
  ).rows[0].r;
  const editBody = {
    sid: fallbackSession,
    expected_revision: editorRevision,
    expense_id: "",
    category_id: catalog.categories.find((c) => c.icon === "water").id,
    note_text: "Hosted note",
    title_text: "Hosted editor expense",
    raw_amount: "20000",
    payer: guestMember,
    beneficiaries: [groupAdminMember, guestMember],
    mode: "total",
    split: "equal",
    values_text: [],
    reason: "Hosted editor check",
  };
  const edited = (
    await db.query(
      "select public.execute_financial_command('save_expense',$1,$2) r",
      [randomUUID(), editBody],
    )
  ).rows[0].r;
  const updateBody = {
    ...editBody,
    expense_id: edited.id,
    expected_revision: edited.revision,
    raw_amount: "30000",
    note_text: "Updated hosted note",
  };
  await db.query(
    "select public.execute_financial_command('save_expense',$1,$2)",
    [randomUUID(), updateBody],
  );
  const readEdited = (
    await db.query("select public.session_details($1) d", [fallbackSession])
  ).rows[0].d.expenses.find((e) => e.id === edited.id);
  assert(
    readEdited.amount === "30000" &&
      readEdited.note === "Updated hosted note" &&
      readEdited.category_name,
    "hosted editor preserves ID and returns category/note metadata",
  );
  assert(
    await denied(
      "select public.save_expense_category($1,null,'Forbidden','other',10,true,'No authority')",
      [createdGroup],
    ),
    "hosted collector without admin role cannot manage categories",
  );
  await db.query("reset role");
  await db.query(
    "update public.settlements set status='confirmed',confirmed_at=now()-interval '31 days' where session_id=$1 and status='pending'",
    [fallbackSession],
  );
  await db.query(
    "update public.sessions set status='settled',settled_at=now()-interval '31 days' where id=$1",
    [fallbackSession],
  );
  await actor(a);
  const fallbackRevision = (
    await db.query("select revision::text r from public.sessions where id=$1", [
      fallbackSession,
    ])
  ).rows[0].r;
  await db.query(
    "select public.unlock_session($1,$2,'Rollback unlock review')",
    [fallbackSession, fallbackRevision],
  );
  assert(
    !(
      await db.query("select public.session_is_locked($1) locked", [
        fallbackSession,
      ])
    ).rows[0].locked,
    "hosted admin unlock is effective",
  );
  assert(
    await denied("select public.apply_financial_change($1,$2,'attendee',$3)", [
      fallbackSession,
      String(Number(fallbackRevision) + 1),
      {
        member_id: groupAdminMember,
        operation: "weight",
        weight: "1",
        reason: "Unlock grants no authority",
      },
    ]),
    "hosted unlock does not grant admin ordinary financial powers",
  );
  await db.query("reset role");
  await db.query("set local role service_role");
  assert(
    await denied(
      "select public.provision_group($1,'Forbidden service bypass','Sport')",
      [a],
    ),
    "hosted service role cannot provision arbitrary owners",
  );
  stage = "roles";
  await actor(b);
  assert(
    (await db.query("select id from public.groups where id=$1", [g]))
      .rowCount === 0,
    "outsider blocked by hosted RLS",
  );
  assert(
    await denied("select public.provision_group($1,'Forbidden','Test')", [b]),
    "normal user cannot provision groups",
  );
  await db.query("reset role");
  await db.query(
    "insert into public.group_members(group_id,user_id,display_name) values($1,$2,'Smoke B')",
    [g, b],
  );
  const people = (
    await db.query(
      "select id,user_id from public.group_members where group_id=$1",
      [g],
    )
  ).rows;
  const am = people.find((p) => p.user_id === a).id,
    bm = people.find((p) => p.user_id === b).id;
  await actor(a);
  await db.query(
    "insert into public.profiles(id,display_name,bank_bin,bank_account_no,bank_account_name) values($1,'Smoke A','970415','12345678','TEST') on conflict(id) do update set bank_bin='970415',bank_account_no='12345678',bank_account_name='TEST'",
    [a],
  );
  stage = "accounting";
  const sid = (
    await db.query(
      "select public.create_session($1,'Rollback test','Test court',now()-interval '1 hour',now()-interval '1 hour',true,$2,'100000',true) id",
      [g, [am, bm]],
    )
  ).rows[0].id;
  const detail = async () =>
    (await db.query("select public.session_details($1) d", [sid])).rows[0].d;
  let s = await detail();
  assert(
    s.expenses[0].allocations.reduce((n, p) => n + BigInt(p.amount), 0n) ===
      100000n,
    "hosted allocation totals conserved",
  );
  await actor(b);
  const initialBatch = (
    await db.query(
      "select last_recalculation_id id from public.sessions where id=$1",
      [sid],
    )
  ).rows[0].id;
  const expenseKey = randomUUID();
  const expenseBody = {
    sid,
    expected_revision: s.revision,
    title_text: "Shared water",
    raw_amount: "20000",
    payer: bm,
    beneficiaries: [am, bm],
    mode: "total",
    split: "equal",
    values_text: [],
    reason: "Smoke proposal",
  };
  await db.query(
    "select public.execute_financial_command('add_expense',$1,$2)",
    [expenseKey, expenseBody],
  );
  assert(
    (
      await db.query(
        "select public.execute_financial_command('add_expense',$1,$2) r",
        [expenseKey, expenseBody],
      )
    ).rows[0].r.replayed,
    "hosted shared expense retry acknowledged without duplication",
  );
  assert(
    (
      await db.query(
        "select id from public.approval_requests where session_id=$1 and type='expense_proposal'",
        [sid],
      )
    ).rowCount === 1,
    "hosted retry creates only one expense proposal",
  );
  assert(
    await denied(
      "select public.execute_financial_command('add_expense',$1,$2)",
      [expenseKey, { ...expenseBody, raw_amount: "30000" }],
    ),
    "hosted financial key rejects changed payload",
  );
  assert(
    await denied("select * from app_private.financial_command_results"),
    "hosted user cannot read private financial receipts",
  );
  assert(
    (await detail()).expenses.length === 1,
    "proposal has no financial effect",
  );
  const r = (
    await db.query(
      "select id,payload_hash from public.approval_requests where session_id=$1 and type='expense_proposal'",
      [sid],
    )
  ).rows[0];
  assert(
    await denied("select public.decide_session_request($1,true,$2)", [
      r.id,
      r.payload_hash,
    ]),
    "requester cannot self approve",
  );
  await actor(a);
  const approvalKey = randomUUID();
  const approvalBody = {
    request_id: r.id,
    approve: true,
    expected_hash: r.payload_hash,
  };
  const approval = (
    await db.query(
      "select public.execute_financial_command('decide_session_request',$1,$2) r",
      [approvalKey, approvalBody],
    )
  ).rows[0].r;
  assert(
    (
      await db.query(
        "select public.execute_financial_command('decide_session_request',$1,$2) r",
        [approvalKey, approvalBody],
      )
    ).rows[0].r.replayed,
    "hosted approval retry does not approve twice",
  );
  const batch = (
    await db.query(
      "select previous_id from public.session_recalculations where id=$1",
      [approval.batch_id],
    )
  ).rows[0];
  assert(
    batch.previous_id === initialBatch,
    "hosted recalculation links to previous batch",
  );
  assert(
    (
      await db.query(
        "select cancelled_by_recalculation_id from public.settlements where session_id=$1 and status='cancelled'",
        [sid],
      )
    ).rows.every((p) => p.cancelled_by_recalculation_id === approval.batch_id),
    "hosted replaced transfers reference cancelling batch",
  );
  assert(
    await denied(
      "select public.execute_financial_command('add_expense',$1,$2)",
      [randomUUID(), expenseBody],
    ),
    "hosted new request cannot use stale financial revision",
  );
  s = await detail();
  assert(s.expenses.length === 2, "collector approval activates proposal");
  const transfer = s.settlements.find((p) => p.status === "pending");
  assert(transfer.amount === "40000", "hosted collector settlement correct");
  assert(
    (
      await db.query(
        "select recalculation_id from public.settlements where id=$1",
        [transfer.id],
      )
    ).rows[0].recalculation_id === approval.batch_id,
    "hosted new transfer references issuing batch",
  );
  await actor(b);
  stage = "receipt permissions";
  const evidence = (
    await db.query("select public.add_payment_evidence($1,'screenshot') id", [
      transfer.id,
    ])
  ).rows[0].id;
  const path = (
    await db.query(
      "select storage_path from public.payment_evidence where id=$1",
      [evidence],
    )
  ).rows[0].storage_path;
  assert(
    await denied(
      "insert into storage.objects(bucket_id,name,metadata) values('3t-payment-evidence','unreserved-smoke.jpg','{}')",
    ),
    "hosted Storage rejects unreserved upload",
  );
  await db.query(
    "insert into storage.objects(bucket_id,name,metadata) values('3t-payment-evidence',$1,$2::jsonb)",
    [path, JSON.stringify({ size: 100, mimetype: "image/jpeg" })],
  );
  await db.query("select public.finalize_receipt('3t-payment-evidence',$1)", [
    evidence,
  ]);
  assert(
    (
      await db.query("select status from public.settlements where id=$1", [
        transfer.id,
      ])
    ).rows[0].status === "pending",
    "evidence never confirms a payment",
  );
  await actor(a);
  assert(
    (
      await db.query(
        "select id from storage.objects where bucket_id='3t-payment-evidence' and name=$1",
        [path],
      )
    ).rowCount === 1,
    "hosted receiver can read proof",
  );
  assert(
    await denied(
      "select public.add_payment_evidence($1,'note',null,'Forbidden')",
      [transfer.id],
    ),
    "hosted receiver cannot impersonate sender",
  );
  assert(
    await denied("select public.cleanup_storage_files()"),
    "hosted user cannot execute service cleanup",
  );
  await db.query("reset role");
  await db.query("set local role anon");
  assert(
    (
      await db.query(
        "select id from storage.objects where bucket_id='3t-payment-evidence' and name=$1",
        [path],
      )
    ).rowCount === 0,
    "hosted anonymous proof read blocked",
  );
  await actor(b);
  stage = "accounting";
  await db.query("select public.payment_action($1,'mark')", [transfer.id]);
  await actor(a);
  await db.query("select public.payment_action($1,'confirm')", [transfer.id]);
  assert(
    (await detail()).status === "settled",
    "manual receipt settles session",
  );
  await actor(b);
  await db.query("select public.request_session_change($1,'leave',$2)", [
    sid,
    { reason: "Smoke refund" },
  ]);
  const leave = (
    await db.query(
      "select id,payload_hash from public.approval_requests where session_id=$1 and type='leave'",
      [sid],
    )
  ).rows[0];
  await actor(a);
  await db.query("select public.decide_session_request($1,true,$2)", [
    leave.id,
    leave.payload_hash,
  ]);
  s = await detail();
  assert(
    s.settlements.some(
      (p) =>
        p.id === transfer.id &&
        p.status === "confirmed" &&
        p.amount === "40000",
    ),
    "confirmed transfer preserved",
  );
  assert(
    s.settlements.some(
      (p) =>
        p.status === "pending" &&
        p.from_member === am &&
        p.to_member === bm &&
        p.amount === "60000",
    ),
    "hosted removal issues correct refund",
  );
  stage = "scheduling";
  const poll = (
    await db.query(
      "select public.create_poll($1,'Rollback scheduling','Test court',2,now()+interval '1 day',jsonb_build_array(jsonb_build_object('starts_at',now()+interval '2 days','ends_at',now()+interval '2 days 2 hours'))) id",
      [g],
    )
  ).rows[0].id;
  const option = (
    await db.query("select id from public.poll_options where poll_id=$1", [
      poll,
    ])
  ).rows[0].id;
  await actor(b);
  await db.query("select public.vote_poll($1,'yes')", [option]);
  assert(
    await denied("select public.close_poll($1,$2)", [poll, option]),
    "legacy poll close cannot create a session",
  );
  await actor(a);
  assert(
    await denied("select public.close_poll($1,$2)", [poll, option]),
    "manual form required instead of legacy poll close",
  );
  await db.query("select public.vote_poll($1,'yes')", [option]);
  const scheduled = (
    await db.query(
      "select public.schedule_poll_meeting($1,$2,$3,jsonb_build_object('g',$4::uuid,'title_text','Manual poll review','venue_text','Test court','start_time',now()+interval '2 days','ends_at',now()+interval '2 days 2 hours','deadline',now()+interval '2 days','note','','be_collector',false,'nominee','','invitees','[]'::jsonb))->>'id' id",
      [randomUUID(), poll, option, g],
    )
  ).rows[0].id;
  assert(
    (
      await db.query(
        "select committed_at from public.session_attendees where session_id=$1",
        [scheduled],
      )
    ).rows.every((r) => r.committed_at === null),
    "poll votes remain uncommitted intentions",
  );
  await db.query("select public.set_weekly_series($1,2)", [scheduled]);
  assert(
    (
      await db.query(
        "select id from public.sessions where weekly_series_id=(select weekly_series_id from public.sessions where id=$1)",
        [scheduled],
      )
    ).rowCount === 3,
    "hosted weekly instances generated",
  );
  stage = "session calendar";
  const calendarRow = async () =>
    (
      await db.query(
        "select to_jsonb(s) s from public.sessions s where id=$1",
        [scheduled],
      )
    ).rows[0].s;
  const calendarBody = (row) => ({
    title: row.title,
    venue: row.venue,
    note: row.note,
    starts_at: row.starts_at,
    commit_deadline: row.commit_deadline,
    reason: "Rollback calendar test",
  });
  let calendar = await calendarRow();
  await actor(b);
  assert(
    await denied("select public.manage_session($1,$2,'edit',$3)", [
      scheduled,
      calendar.revision,
      { ...calendarBody(calendar), title: "Forbidden" },
    ]),
    "hosted member cannot edit someone else's calendar",
  );
  await db.query("select public.set_rsvp($1,true)", [scheduled]);
  await actor(a);
  calendar = await calendarRow();
  const moved = {
    ...calendarBody(calendar),
    commit_deadline: new Date(
      Date.parse(calendar.starts_at) - 30 * 60 * 1000,
    ).toISOString(),
  };
  await db.query("select public.manage_session($1,$2,'edit',$3)", [
    scheduled,
    calendar.revision,
    moved,
  ]);
  assert(
    (
      await db.query(
        "select committed_at from public.session_attendees where session_id=$1 and member_id=$2",
        [scheduled, bm],
      )
    ).rows[0].committed_at === null,
    "hosted reschedule resets commitments for self reconfirmation",
  );
  assert(
    await denied("select public.manage_session($1,$2,'edit',$3)", [
      scheduled,
      calendar.revision,
      moved,
    ]),
    "hosted stale calendar edit rejected",
  );
  calendar = await calendarRow();
  await db.query("select public.manage_session($1,$2,'cancel',$3)", [
    scheduled,
    calendar.revision,
    { reason: "Rollback cancellation" },
  ]);
  assert(
    (await calendarRow()).status === "cancelled",
    "hosted money-free session can be cancelled",
  );
  calendar = await calendarRow();
  await actor(b);
  assert(
    await denied("select public.set_rsvp($1,true)", [scheduled]),
    "hosted cancelled session cannot accept RSVP",
  );
  await actor(a);
  await db.query("select public.manage_session($1,$2,'reopen',$3)", [
    scheduled,
    calendar.revision,
    calendarBody(calendar),
  ]);
  assert(
    (await calendarRow()).status === "planned",
    "hosted cancelled session reopens with future deadline",
  );
  assert(
    await denied("select public.manage_session($1,$2,'cancel',$3)", [
      sid,
      (await detail()).revision,
      { reason: "Must retain money" },
    ]),
    "hosted calendar cancellation cannot bypass financial history",
  );
  stage = "scheduling";
  assert(
    await denied("select public.run_scheduled_jobs()"),
    "users cannot call scheduled maintenance",
  );
  await db.query("reset role");
  await db.query("select public.run_scheduled_jobs()");
  const notificationCount = (
    await db.query(
      "select count(*)::int n from public.notifications where group_id=$1",
      [g],
    )
  ).rows[0].n;
  await db.query("select public.run_scheduled_jobs()");
  assert(
    (
      await db.query(
        "select count(*)::int n from public.notifications where group_id=$1",
        [g],
      )
    ).rows[0].n === notificationCount,
    "hosted reminder retry deduplicated",
  );
  stage = "receipt expiry";
  assert(
    await denied(
      "update public.settlements set confirmed_at=now()-interval '31 days' where id=$1",
      [transfer.id],
    ),
    "confirmed payment timestamp is immutable",
  );
  const expiredPayment = (
    await db.query(
      "insert into public.settlements(session_id,from_member,to_member,amount,ref_code,status,confirmed_at) values($1,$2,$3,1000,public.next_payment_ref(),'confirmed',now()-interval '31 days') returning id",
      [sid, bm, am],
    )
  ).rows[0].id;
  const expired = (
    await db.query(
      "insert into public.payment_evidence(settlement_id,group_id,uploaded_by,kind,storage_path,status) values($1,$2::uuid,$3,'screenshot',$2::uuid::text||'/'||gen_random_uuid()||'.jpg','ready') returning id,storage_path",
      [expiredPayment, g, b],
    )
  ).rows[0];
  await db.query(
    "insert into storage.objects(bucket_id,name,metadata) values('3t-payment-evidence',$1,$2::jsonb)",
    [
      expired.storage_path,
      JSON.stringify({ size: 100, mimetype: "image/jpeg" }),
    ],
  );
  await actor(b);
  assert(
    (
      await db.query(
        "select id from storage.objects where bucket_id='3t-payment-evidence' and name=$1",
        [expired.storage_path],
      )
    ).rowCount === 0,
    "hosted expired proof inaccessible before cleanup",
  );
  await db.query("reset role");
  await db.query("select public.expire_receipt_files()");
  assert(
    (
      await db.query("select status from public.payment_evidence where id=$1", [
        expired.id,
      ])
    ).rows[0].status === "expired",
    "hosted expired proof retains metadata",
  );
  assert(
    (
      await db.query(
        "select id from public.storage_cleanup_jobs where bucket='3t-payment-evidence' and path=$1",
        [expired.storage_path],
      )
    ).rowCount === 1,
    "hosted expiry queues physical deletion",
  );
  stage = "rollback";
  await db.query("rollback");
  transaction = false;
  assert(
    JSON.stringify(await counts()) === JSON.stringify(before),
    "all temporary business data rolled back",
  );
  assert(
    (await adminFingerprint()) === adminsBefore,
    "hosted admin allowlist preserved after rollback",
  );
  assert(
    (await db.query("select count(*)::text n from auth.users")).rows[0].n ===
      authBefore,
    "existing Auth users preserved",
  );
  const tables = await db.query(
    "select count(*)::integer total,count(*) filter(where rowsecurity)::integer protected from pg_tables where schemaname='public'",
  );
  console.log(
    JSON.stringify({
      passed,
      publicTables: tables.rows[0],
      authUsersPreserved: true,
      testDataPersisted: false,
    }),
  );
} catch (e) {
  if (transaction) await db.query("rollback").catch(() => {});
  console.error(
    JSON.stringify({ stage, errorCode: e.code || e.name, label: e.label }),
  );
  process.exitCode = 1;
} finally {
  await db.end().catch(() => {});
}
