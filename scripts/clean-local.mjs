import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import pg from "pg";
import { isLoopbackUrl } from "../src/lib/local-development-config.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const seedGroup = "00000000-0000-4000-8000-000000003001";
const uuid = "[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}";
const fixtureOwners = new Map([
  ["Decision runtime fixture", /^decision-owner@3t\.test$/],
  ["Browser creation fixture", /^decision-owner@3t\.test$/],
  ["Payment browser fixture", /^payment-receiver@3t\.test$/],
  ["Poll browser fixture", /^poll-admin@3t\.test$/],
  ["Invite gate fixture", /^invite-owner@3t\.test$/],
  ["Account onboarding fixture", /^onboarding-owner@3t\.test$/],
  ["Profile UI fixture", /^ui-acceptance@3t\.test$/],
  ["UX minimal fixture", /^minimal-owner@3t\.test$/],
  ["First group UI fixture", new RegExp(`^first-group-${uuid}@3t\\.test$`)],
  ["Lịch nhóm thử nghiệm", /^meeting-admin@3t\.test$/],
  ["Cầu lông cùng bạn", /^theme-member@3t\.test$/],
  ["Lịch trống", new RegExp(`^empty-calendar-${uuid}@3t\\.test$`)],
  ["Nhóm UX", new RegExp(`^calendar-${uuid}@3t\\.test$`)],
  ["Nhóm đã rời", new RegExp(`^calendar-${uuid}@3t\\.test$`)],
]);
export function isFixtureGroup({ id, name, owner }) {
  if (id === seedGroup) return false;
  return (
    !!fixtureOwners.get(name)?.test(owner) ||
    (/^\[GIẢ LẬP\] Nhóm bạn [a-f0-9]{6}$/.test(name) &&
      new RegExp(`^sim-admin-${uuid}@3t\\.test$`).test(owner))
  );
}
const requireLocal = (value, code) => {
  if (!value) throw Object.assign(new Error(code), { code });
};
const quote = (value) => `"${value.replaceAll('"', '""')}"`;

// This is a local maintenance command, never an application action or migration.
export async function cleanLocal({ apply = false, sessionIds } = {}) {
  delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  const env = parseEnv(
    readFileSync(resolve(root, ".env.development.local"), "utf8"),
  );
  const status = JSON.parse(
    execFileSync(
      process.execPath,
      [
        resolve(root, ".tools/supabase/node_modules/supabase/dist/supabase.js"),
        "status",
        "--output",
        "json",
      ],
      {
        cwd: root,
        encoding: "utf8",
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      },
    ),
  );
  const uri = new URL(env.SUPABASE_DB_URL),
    cliUri = new URL(status.DB_URL);
  requireLocal(
    env.THREE_T_LOCAL_DEVELOPMENT === "1" &&
      isLoopbackUrl(env.NEXT_PUBLIC_SUPABASE_URL) &&
      isLoopbackUrl(status.API_URL),
    "LOCAL_ENV_REQUIRED",
  );
  requireLocal(
    [uri, cliUri].every(
      (u) =>
        ["postgres:", "postgresql:"].includes(u.protocol) &&
        ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname) &&
        u.pathname === "/postgres",
    ) &&
      uri.port === cliUri.port &&
      new URL(env.NEXT_PUBLIC_SUPABASE_URL).port ===
        new URL(status.API_URL).port,
    "LOCAL_STACK_MISMATCH",
  );
  const db = new pg.Client({
    connectionString: env.SUPABASE_DB_URL,
    connectionTimeoutMillis: 10000,
  });
  let transaction = false;
  try {
    await db.connect();
    await db.query("begin");
    transaction = true;
    await db.query("set local lock_timeout='5s'");
    await db.query("set local statement_timeout='30s'");
    const tables = (
      await db.query(`select c.oid::text oid,n.nspname schema,c.relname name,
      array(select a.attname::text from pg_index i join unnest(i.indkey) with ordinality k(num,ord) on true join pg_attribute a on a.attrelid=c.oid and a.attnum=k.num where i.indrelid=c.oid and i.indisprimary order by k.ord) keys
      from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind='r' and n.nspname in ('public','app_private') order by c.oid`)
    ).rows;
    const byId = new Map(
      tables.map((t) => [
        t.oid,
        {
          ...t,
          sql: `${quote(t.schema)}.${quote(t.name)}`,
          temp: quote(`_local_cleanup_${t.oid}`),
        },
      ]),
    );
    // Exclusive transaction locks prevent new child records while the scope is backed up.
    await db.query(
      `lock table ${[...byId.values()].map((t) => t.sql).join(",")} in access exclusive mode`,
    );
    const byName = new Map(
      [...byId.values()].map((t) => [`${t.schema}.${t.name}`, t]),
    );
    const fks = (
      await db.query(`select c.conrelid::text child,c.confrelid::text parent,
      array(select a.attname::text from unnest(c.conkey) with ordinality k(num,ord) join pg_attribute a on a.attrelid=c.conrelid and a.attnum=k.num order by k.ord) columns,
      array(select a.attname::text from unnest(c.confkey) with ordinality k(num,ord) join pg_attribute a on a.attrelid=c.confrelid and a.attnum=k.num order by k.ord) parent_columns
      from pg_constraint c where c.contype='f'`)
    ).rows.filter((f) => byId.has(f.child) && byId.has(f.parent));
    for (const t of byId.values())
      if (t.keys.length) {
        await db.query(
          `create temp table ${t.temp} (like ${t.sql}) on commit drop`,
        );
        await db.query(
          `alter table ${t.temp} add primary key (${t.keys.map(quote).join(",")})`,
        );
      }
    const groups = (
      await db.query(
        "select g.id,g.name,u.email owner from public.groups g join auth.users u on u.id=g.created_by",
      )
    ).rows;
    const groupIds = sessionIds
      ? []
      : groups.filter(isFixtureGroup).map((g) => g.id);
    const smoke = (
      await db.query(
        `select s.id from public.sessions s join auth.users u on u.id=s.created_by
      where s.group_id=$1 and s.title ~ '^Lịch kiểm tra local · [a-f0-9]{6}$' and u.email='an@local.3t.test' and s.status='planned'
      and not exists(select 1 from public.expenses e where e.session_id=s.id) and not exists(select 1 from public.settlements p where p.session_id=s.id)
      and ($2::uuid[] is null or s.id=any($2))`,
        [seedGroup, sessionIds || null],
      )
    ).rows.map((s) => s.id);
    if (sessionIds)
      requireLocal(
        smoke.length === sessionIds.length,
        "SESSION_SCOPE_NOT_AUTOMATED_TEST_DATA",
      );
    const groupTable = byName.get("public.groups"),
      sessionTable = byName.get("public.sessions");
    await db.query(
      `insert into ${groupTable.temp} select * from public.groups where id=any($1::uuid[])`,
      [groupIds],
    );
    await db.query(
      `insert into ${sessionTable.temp} select * from public.sessions where id=any($1::uuid[])`,
      [smoke],
    );
    const notificationTable = byName.get("public.notifications");
    await db.query(
      `insert into ${notificationTable.temp} select * from public.notifications where group_id=$1 and href=any($2::text[])`,
      [seedGroup, smoke.map((id) => `/sessions/${id}`)],
    );
    let added;
    do {
      added = 0;
      for (const fk of fks) {
        const child = byId.get(fk.child),
          parent = byId.get(fk.parent);
        requireLocal(
          child.keys.length && parent.keys.length,
          "PRIMARY_KEY_REQUIRED_FOR_CLEANUP",
        );
        const match = fk.columns
          .map((c, i) => `c.${quote(c)}=p.${quote(fk.parent_columns[i])}`)
          .join(" and ");
        const same = child.keys
          .map((c) => `c.${quote(c)}=x.${quote(c)}`)
          .join(" and ");
        added += (
          await db.query(
            `insert into ${child.temp} select c.* from ${child.sql} c where exists(select 1 from ${parent.temp} p where ${match}) and not exists(select 1 from ${child.temp} x where ${same}) on conflict do nothing`,
          )
        ).rowCount;
      }
    } while (added);
    // Never follow a cross-group reference into manually maintained sessions/groups.
    const selectedSessions = (
      await db.query(`select id,group_id from ${sessionTable.temp}`)
    ).rows;
    requireLocal(
      selectedSessions.every(
        (s) => groupIds.includes(s.group_id) || smoke.includes(s.id),
      ),
      "CLEANUP_WOULD_INCLUDE_MANUAL_SESSIONS",
    );
    requireLocal(
      (await db.query(`select id from ${groupTable.temp}`)).rows.every((g) =>
        groupIds.includes(g.id),
      ),
      "CLEANUP_WOULD_INCLUDE_MANUAL_GROUPS",
    );
    for (const name of [
      "public.group_members",
      "public.polls",
      "public.weekly_series",
    ]) {
      const t = byName.get(name);
      const rows = (await db.query(`select distinct group_id from ${t.temp}`))
        .rows;
      requireLocal(
        rows.every((r) => groupIds.includes(r.group_id)),
        "CLEANUP_WOULD_INCLUDE_MANUAL_GROUP_DATA",
      );
    }
    const selected = [];
    for (const t of byId.values())
      if (t.keys.length) {
        const count = Number(
          (await db.query(`select count(*) from ${t.temp}`)).rows[0].count,
        );
        if (count) selected.push({ ...t, count });
      }
    const summary = {
      localOnly: true,
      applied: apply,
      groups: groupIds.length,
      sessions: selectedSessions.length,
      smokeSessions: smoke.length,
      rows: Object.fromEntries(
        selected.map((t) => [`${t.schema}.${t.name}`, t.count]),
      ),
    };
    if (!apply || !selected.length) {
      await db.query("rollback");
      transaction = false;
      return summary;
    }
    const kept = async () =>
      (
        await db.query(
          "select to_jsonb(s) data from public.sessions s where group_id=$1 and not(id=any($2::uuid[])) order by id",
          [seedGroup, smoke],
        )
      ).rows;
    const before = JSON.stringify(await kept());
    const backup = {
      createdAt: new Date().toISOString(),
      ...summary,
      tables: [],
    };
    for (const t of selected) {
      const rows = (
        await db.query(`select to_jsonb(t) data from ${t.temp} t`)
      ).rows.map((r) => r.data);
      requireLocal(
        rows.every(
          (r) =>
            !r.group_id ||
            groupIds.includes(r.group_id) ||
            (r.group_id === seedGroup &&
              ((t.oid === sessionTable.oid && smoke.includes(r.id)) ||
                smoke.includes(r.session_id) ||
                smoke.some((id) => r.href === `/sessions/${id}`))),
        ),
        "CLEANUP_WOULD_CROSS_GROUP_BOUNDARY",
      );
      backup.tables.push({
        schema: t.schema,
        table: t.name,
        keys: t.keys,
        rows,
      });
    }
    const directory = `.tools/local-cleanup/${new Date().toISOString().replaceAll(/[:.]/g, "-")}`;
    const backupPath = `${directory}/rows.json`;
    execFileSync(
      "git",
      [
        "-c",
        `safe.directory=${root.replaceAll("\\", "/").replace(/\/$/, "")}`,
        "check-ignore",
        "-q",
        "--",
        backupPath,
      ],
      { cwd: root, windowsHide: true, stdio: "ignore" },
    );
    mkdirSync(resolve(root, directory), { recursive: true });
    writeFileSync(resolve(root, backupPath), JSON.stringify(backup), {
      flag: "wx",
      mode: 0o600,
    });
    // Break the nullable session/recalculation cycle; every updated row is already backed up for deletion.
    await db.query(
      `update public.sessions s set last_recalculation_id=null where last_recalculation_id is not null and exists(select 1 from ${sessionTable.temp} x where x.id=s.id)`,
    );
    const guards = (
      await db.query(`select c.oid::text oid,n.nspname schema,c.relname table_name,t.tgname name,t.tgenabled enabled
      from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace join pg_proc p on p.oid=t.tgfoid
      where not t.tgisinternal and (t.tgtype & 8)>0 and p.proname in ('immutable_log','protect_confirmed')`)
    ).rows.filter((g) => selected.some((t) => t.oid === g.oid));
    for (const g of guards) {
      requireLocal(g.enabled === "O", "UNEXPECTED_TRIGGER_STATE");
      await db.query(
        `alter table ${quote(g.schema)}.${quote(g.table_name)} disable trigger ${quote(g.name)}`,
      );
    }
    // FK checks remain enabled. Children are deleted before their parents.
    const remaining = new Map(selected.map((t) => [t.oid, t]));
    const dependencies = fks.filter(
      (f) =>
        f.child !== f.parent &&
        !(
          byId.get(f.child).name === "sessions" &&
          f.columns.includes("last_recalculation_id")
        ),
    );
    while (remaining.size) {
      const t = [...remaining.values()].find(
        (table) =>
          !dependencies.some(
            (f) => f.parent === table.oid && remaining.has(f.child),
          ),
      );
      requireLocal(t, "UNSUPPORTED_FOREIGN_KEY_CYCLE");
      const same = t.keys
        .map((c) => `t.${quote(c)}=x.${quote(c)}`)
        .join(" and ");
      const removed = await db.query(
        `delete from ${t.sql} t using ${t.temp} x where ${same}`,
      );
      requireLocal(removed.rowCount === t.count, "CLEANUP_ROW_COUNT_MISMATCH");
      remaining.delete(t.oid);
    }
    for (const g of guards)
      await db.query(
        `alter table ${quote(g.schema)}.${quote(g.table_name)} enable trigger ${quote(g.name)}`,
      );
    requireLocal(
      JSON.stringify(await kept()) === before,
      "MANUAL_DATA_CHANGED",
    );
    await db.query("commit");
    transaction = false;
    return { ...summary, backup: backupPath };
  } finally {
    if (transaction) await db.query("rollback").catch(() => {});
    await db.end();
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  cleanLocal({ apply: process.argv.includes("--apply") })
    .then((result) => console.log(JSON.stringify(result)))
    .catch((error) => {
      console.error(
        JSON.stringify({
          code: error.code || error.name,
          hint: "Chỉ chạy với Supabase local và .env.development.local; database hosted không được dùng.",
        }),
      );
      process.exitCode = 1;
    });
}
