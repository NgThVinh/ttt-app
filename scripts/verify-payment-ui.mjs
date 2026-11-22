import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { localBrowser, check } from "./local-browser.mjs";
let app,
  step = "start";
try {
  app = await localBrowser(3220, ".tools/payment-ui");
  const { origin, db } = app;
  const receiver = await app.login("payment-receiver@3t.test");
  const sender = await app.login("payment-sender@3t.test");
  const peer = await app.login("payment-peer@3t.test");
  const group = randomUUID();
  await db.query(
    "insert into public.groups(id,name,sport,created_by) values($1,'Payment browser fixture','Test',$2)",
    [group, receiver.user.id],
  );
  const members = [];
  for (const [index, actor] of [receiver, sender, peer].entries()) {
    await db.query(
      "insert into public.profiles(id,display_name,bank_bin,bank_account_no,bank_account_name) values($1,$2,'970436','123456789','BROWSER TEST') on conflict(id) do update set bank_bin=excluded.bank_bin,bank_account_no=excluded.bank_account_no,bank_account_name=excluded.bank_account_name",
      [actor.user.id, ["Receiver", "Sender", "Peer"][index]],
    );
    members.push(
      (
        await db.query(
          "insert into public.group_members(group_id,user_id,display_name,role) values($1,$2,$3,$4) returning id",
          [
            group,
            actor.user.id,
            ["Receiver", "Sender", "Peer"][index],
            index ? "member" : "admin",
          ],
        )
      ).rows[0].id,
    );
  }
  step = "create";
  const time = new Date(Date.now() - 3600000).toISOString();
  const created = await receiver.client.rpc("execute_financial_command", {
    command_name: "create_session_bundle",
    request_key: randomUUID(),
    body: {
      g: group,
      title_text: "Payment browser acceptance",
      venue_text: "Local court",
      start_time: time,
      deadline: time,
      already_played: true,
      people: members.slice(0, 2),
      court: "100000",
      be_collector: true,
      nominee: "",
      weights: Object.fromEntries(members.slice(0, 2).map((id) => [id, "1"])),
      extras: [],
    },
  });
  check(!created.error, "SESSION_CREATE_FAILED");
  const sid = created.data.id;
  const payment = (
    await db.query("select * from public.settlements where session_id=$1", [
      sid,
    ])
  ).rows[0];
  check(
    payment.amount === "50000" && payment.status === "pending",
    "FIXTURE_ALLOCATION",
  );
  const paymentState = async () =>
    (
      await db.query("select status from public.settlements where id=$1", [
        payment.id,
      ])
    ).rows[0].status;
  await sender.page.goto(origin + "/sessions/" + sid);
  await sender.page
    .getByRole("heading", { name: "Payment browser acceptance", exact: true })
    .waitFor();
  const panel = sender.page
    .locator("article.session-row")
    .filter({ hasText: "3T-" + payment.ref_code });
  await panel.getByText("QR chưa khả dụng.", { exact: false }).waitFor();
  step = "upload";
  await panel.getByLabel("Chọn ảnh biên lai").setInputFiles({
    name: "proof.png",
    mimeType: "image/png",
    buffer: readFileSync("public/icon-192.png"),
  });
  await panel
    .getByRole("status")
    .filter({ hasText: "Đã lưu ảnh riêng tư" })
    .waitFor();
  check(
    (await paymentState()) === "pending",
    "UPLOAD_MUST_NOT_MARK_OR_CONFIRM",
  );
  const evidence = (
    await db.query(
      "select id,storage_path,status from public.payment_evidence where settlement_id=$1 and status='ready'",
      [payment.id],
    )
  ).rows[0];
  check(evidence, "EVIDENCE_NOT_READY");
  step = "evidence-permissions";
  for (const actor of [receiver, sender])
    check(
      !(
        await actor.client.storage
          .from("3t-payment-evidence")
          .download(evidence.storage_path)
      ).error,
      "AUTHORIZED_STORAGE_READ",
    );
  check(
    !!(
      await peer.client.storage
        .from("3t-payment-evidence")
        .download(evidence.storage_path)
    ).error,
    "PEER_STORAGE_DENIED",
  );
  check(
    (
      await peer.client
        .from("payment_evidence")
        .select("id")
        .eq("id", evidence.id)
    ).data?.length === 0,
    "PEER_METADATA_DENIED",
  );
  const anonymous = await fetch(
    new URL(
      "/storage/v1/object/public/3t-payment-evidence/" + evidence.storage_path,
      (
        await app.admin.storage
          .from("3t-payment-evidence")
          .createSignedUrl(evidence.storage_path, 60)
      ).data.signedUrl,
    ),
  );
  check(!anonymous.ok, "PUBLIC_STORAGE_DENIED");
  step = "lost-response";
  let drop = true;
  await sender.page.route(origin + "/sessions/" + sid, async (route) => {
    if (drop && route.request().method() === "POST") {
      drop = false;
      await route.fetch();
      await route.abort("connectionreset");
    } else await route.continue();
  });
  await panel
    .getByRole("button", { name: "Tôi đã chuyển", exact: true })
    .click();
  await sender.page
    .getByRole("alert")
    .filter({ hasText: "Chưa nhận được kết quả" })
    .waitFor();
  check(
    (await paymentState()) === "marked_paid",
    "MARK_COMMITTED_BEFORE_NETWORK_FAILURE",
  );
  const before = (
    await db.query(
      "select count(*) from app_private.financial_command_results where actor_id=$1 and command_name='payment_action' and session_id=$2",
      [sender.user.id, sid],
    )
  ).rows[0].count;
  await panel
    .getByRole("button", { name: "Tôi đã chuyển", exact: true })
    .click();
  await sender.page
    .getByRole("status")
    .filter({ hasText: "Đã báo chuyển" })
    .waitFor();
  const after = (
    await db.query(
      "select count(*) from app_private.financial_command_results where actor_id=$1 and command_name='payment_action' and session_id=$2",
      [sender.user.id, sid],
    )
  ).rows[0].count;
  check(before === "1" && after === "1", "RETRY_MUST_REUSE_REQUEST_KEY");
  check((await paymentState()) === "marked_paid", "SENDER_CANNOT_CONFIRM");
  step = "confirm";
  await receiver.page.goto(origin + "/sessions/" + sid);
  const receivedPanel = receiver.page
    .locator("article.session-row")
    .filter({ hasText: "3T-" + payment.ref_code });
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  let intercepted;
  const entered = new Promise((resolve) => (intercepted = resolve));
  await receiver.page.route(origin + "/sessions/" + sid, async (route) => {
    if (route.request().method() === "POST") {
      intercepted();
      await gate;
    }
    await route.continue();
  });
  await receivedPanel
    .getByRole("button", { name: "Đã nhận", exact: true })
    .click();
  await entered;
  check((await paymentState()) === "marked_paid", "CONFIRM_WAITS_FOR_SERVER");
  check(
    await receivedPanel
      .getByRole("button", { name: "Đang xử lý…", exact: true })
      .isDisabled(),
    "CONFIRM_PENDING_DISABLED",
  );
  release();
  // Successful revalidation removes the form and its transient success text.
  // Assert the durable payment state and the refreshed settlement label.
  for (let i = 0; i < 100 && (await paymentState()) !== "confirmed"; i++)
    await new Promise((resolve) => setTimeout(resolve, 100));
  check((await paymentState()) === "confirmed", "CONFIRM_SUCCESS");
  await receivedPanel
    .locator("p")
    .filter({ hasText: /^Đã nhận$/ })
    .waitFor();
  await receiver.page.screenshot({
    path: ".tools/payment-ui/confirmed.png",
    fullPage: true,
    caret: "initial",
  });
  step = "adjustment-preview";
  await receiver.page.reload();
  await receiver.page
    .getByRole("heading", { name: "Payment browser acceptance", exact: true })
    .waitFor();
  const duplicateIds = await receiver.page.evaluate(() => {
    const seen = new Set();
    return [...document.querySelectorAll("[id]")]
      .map((el) => el.id)
      .filter((id) => {
        if (seen.has(id)) return true;
        seen.add(id);
        return false;
      });
  });
  check(
    duplicateIds.length === 0,
    "DUPLICATE_FORM_IDS_" + duplicateIds.join(","),
  );
  const changePanel = receiver.page.locator("section.panel").filter({
    has: receiver.page.getByRole("heading", {
      name: "Sửa người, hệ số hoặc xóa khoản chi",
      exact: true,
    }),
  });
  async function previewRemoval() {
    const details = receiver.page
      .locator("details")
      .filter({
        has: receiver.page
          .locator("summary")
          .getByText("Điều chỉnh người và phần chia", { exact: true }),
      });
    if (!(await details.getAttribute("open"))) {
      if (await details.evaluate((el) => !el.open))
        await receiver.page
          .getByText("Điều chỉnh người và phần chia", { exact: true })
          .click();
    }
    await receiver.page.screenshot({
      path: ".tools/payment-ui/before-adjustment.png",
      fullPage: true,
      caret: "initial",
    });
    step = "adjustment-member";
    await changePanel
      .getByLabel("Thành viên", { exact: true })
      .selectOption(members[1]);
    step = "adjustment-operation";
    await changePanel
      .getByLabel("Thao tác", { exact: true })
      .selectOption("remove");
    step = "adjustment-reason";
    await changePanel
      .getByLabel("Lý do", { exact: true })
      .fill("Browser refund acceptance");
    step = "adjustment-click-preview";
    await changePanel
      .getByRole("button", { name: "Xem trước thay đổi", exact: true })
      .click();
    await changePanel
      .getByRole("heading", { name: "Công nợ sau thay đổi", exact: true })
      .waitFor();
  }
  await previewRemoval();
  check(
    (
      await db.query(
        "select count(*) from public.settlements where session_id=$1 and status='pending'",
        [sid],
      )
    ).rows[0].count === "0",
    "PREVIEW_MUST_ROLL_BACK",
  );
  const revision = (
    await db.query("select revision from public.sessions where id=$1", [sid])
  ).rows[0].revision;
  const concurrent = await receiver.client.rpc("execute_financial_command", {
    command_name: "apply_financial_change",
    request_key: randomUUID(),
    body: {
      sid,
      expected_revision: String(revision),
      action_name: "attendee",
      body: {
        member_id: members[0],
        operation: "weight",
        weight: "2",
        reason: "Concurrent edit fixture",
      },
    },
  });
  check(!concurrent.error, "CONCURRENT_EDIT_FAILED");
  await changePanel
    .getByRole("button", { name: "Xác nhận lưu thay đổi", exact: true })
    .click();
  await changePanel
    .getByRole("alert")
    .filter({ hasText: "Buổi có thể đã thay đổi" })
    .waitFor();
  check(
    (
      await db.query(
        "select removed_at from public.session_attendees where session_id=$1 and member_id=$2",
        [sid, members[1]],
      )
    ).rows[0].removed_at === null,
    "STALE_PREVIEW_MUST_NOT_APPLY",
  );
  await receiver.page.reload();
  await previewRemoval();
  check(
    (await changePanel.innerText()).includes("50.000đ"),
    "REFUND_PREVIEW_AMOUNT",
  );
  await changePanel
    .getByRole("button", { name: "Xác nhận lưu thay đổi", exact: true })
    .click();
  for (let i = 0; i < 100; i++) {
    const row = (
      await db.query(
        "select id from public.settlements where session_id=$1 and status='pending' and from_member=$2 and to_member=$3 and amount=50000",
        [sid, members[0], members[1]],
      )
    ).rows[0];
    if (row) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  check(
    (
      await db.query(
        "select count(*) from public.settlements where session_id=$1 and status='pending' and from_member=$2 and to_member=$3 and amount=50000",
        [sid, members[0], members[1]],
      )
    ).rows[0].count === "1",
    "REFUND_EXACT_AMOUNT",
  );
  check(
    (await paymentState()) === "confirmed",
    "ADJUSTMENT_MUST_PRESERVE_CONFIRMED_CASH",
  );
  step = "collector-change";
  const nominated = await receiver.client.rpc("request_session_change", {
    sid,
    kind: "collector_nomination",
    body: { member_id: members[2], reason: "Browser handover acceptance" },
  });
  check(!nominated.error, "NOMINATION_FAILED");
  const approval = (
    await db.query(
      "select id from public.approval_requests where session_id=$1 and type='collector_nomination' and status='pending'",
      [sid],
    )
  ).rows[0];
  await peer.page.goto(origin + "/approvals");
  const approvalPanel = peer.page.locator("section.panel").filter({
    has: peer.page.locator(`input[name="id"][value="${approval.id}"]`),
  });
  await approvalPanel
    .getByRole("button", { name: "Xem trước nội dung sẽ duyệt", exact: true })
    .click();
  await approvalPanel
    .getByRole("heading", { name: "Phần chia sau thay đổi", exact: true })
    .waitFor();
  await approvalPanel
    .getByRole("button", {
      name: "Đồng ý bước đề cử / nhận vai trò",
      exact: true,
    })
    .click();
  for (let i = 0; i < 100; i++) {
    const row = (
      await db.query(
        "select collector_member_id from public.sessions where id=$1",
        [sid],
      )
    ).rows[0];
    if (row.collector_member_id === members[2]) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  check(
    (
      await db.query(
        "select collector_member_id from public.sessions where id=$1",
        [sid],
      )
    ).rows[0].collector_member_id === members[2],
    "NOMINEE_ACCEPTANCE_REQUIRED",
  );
  check(
    (await paymentState()) === "confirmed",
    "CONFIRMED_PAYMENT_PRESERVED_ON_HANDOVER",
  );
  for (const actor of [receiver, sender])
    check(
      !(
        await actor.client.storage
          .from("3t-payment-evidence")
          .download(evidence.storage_path)
      ).error,
      "HISTORIC_PARTY_RETAINS_PROOF",
    );
  check(
    !!(
      await peer.client.storage
        .from("3t-payment-evidence")
        .download(evidence.storage_path)
    ).error,
    "NEW_COLLECTOR_CANNOT_READ_OTHERS_HISTORIC_PROOF",
  );
  step = "removed-member";
  check(
    !(await sender.client.rpc("session_details", { sid })).error,
    "ACTIVE_MEMBER_SESSION_ACCESS",
  );
  const removed = await receiver.client.rpc("manage_member", {
    g: group,
    target: members[1],
    operation: "remove",
    label: null,
  });
  check(!removed.error, "MEMBER_REMOVAL_FAILED");
  check(
    !!(
      await sender.client.storage
        .from("3t-payment-evidence")
        .download(evidence.storage_path)
    ).error,
    "REMOVED_MEMBER_STORAGE_DENIED",
  );
  check(
    (
      await sender.client
        .from("payment_evidence")
        .select("id")
        .eq("id", evidence.id)
    ).data?.length === 0,
    "REMOVED_MEMBER_METADATA_DENIED",
  );
  check(
    (await sender.client.rpc("session_details", { sid })).error?.code ===
      "P0001",
    "REMOVED_MEMBER_SESSION_DENIED",
  );
  console.log(
    JSON.stringify({
      passed: true,
      localOnly: true,
      providerCalls: 0,
      qrCopyFallback: true,
      browserImageUpload: true,
      uploadDoesNotConfirm: true,
      privateStoragePermissions: true,
      lostResponseRetryExactlyOnce: true,
      confirmationWaitsForServer: true,
      stalePreviewRejected: true,
      postCollectionRefund: "50000",
      collectorHandoverViaReviewedUI: true,
      historicEvidencePermissions: true,
      removedMemberDenied: true,
    }),
  );
} catch (error) {
  console.error(JSON.stringify({ code: error.code || error.name, step }));
  process.exitCode = 1;
} finally {
  await app?.close();
}
