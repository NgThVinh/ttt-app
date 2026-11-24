const actor = document.querySelector("#actor"),
  content = document.querySelector("#content"),
  message = document.querySelector("#message");
let state, preview, editing;
const money = (n) => BigInt(n).toLocaleString("vi-VN") + "đ";
const escape = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const name = (id) => state.members.find((m) => m.id === id)?.name || id;
async function request(body) {
  const response = await fetch("/api", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ actor: actor.value, ...body }),
  });
  const data = await response.json();
  if (!response.ok) throw Error(data.error);
  return data;
}
function input() {
  return {
    title: document.querySelector("#title").value,
    amount: document.querySelector("#amount").value,
    people: [...document.querySelectorAll(".person")]
      .filter((row) => row.querySelector("[type=checkbox]").checked)
      .map((row) => ({
        id: row.dataset.id,
        value: row.querySelector("[data-weight]").value,
      })),
  };
}
async function load() {
  state = await (await fetch("/api?actor=" + actor.value)).json();
  preview = null;
  if (state.blocked) {
    content.innerHTML =
      "<section><h2>Chờ lời mời vào nhóm</h2><p>Bạn cần được mời vào nhóm để dùng tính năng.</p></section>";
    return;
  }
  content.innerHTML = `<section><h2>Nhóm cầu lông giả lập</h2><p>${state.members.map((m) => escape(m.name)).join(" · ")}</p></section>`;
  if (state.members.some((m) => m.id === actor.value)) {
    content.innerHTML += `<section><h2>${editing ? "Điều chỉnh buổi" : "Tạo buổi"}</h2><form id="create"><label>Tên buổi<input id="title" required value="${escape(editing?.title || "Cầu lông tối thứ Năm")}"></label><label>Tiền sân (đ)<input id="amount" inputmode="numeric" required value="${editing?.amount || ""}" placeholder="100.000"></label><p>Hệ số: 1 = cả buổi, 0,5 = nửa buổi.</p>${state.members.map((m) => `<label class="person" data-id="${m.id}"><input type="checkbox" ${!editing || editing.people.some((p) => p.id === m.id) ? "checked" : ""}>${escape(m.name)}<input data-weight aria-label="Hệ số ${escape(m.name)}" value="${editing?.people.find((p) => p.id === m.id)?.value || "1"}"></label>`).join("")}<button type="button" id="preview">Xem bảng chia</button><div id="preview-result"></div><button id="save" disabled>${editing ? "Lưu điều chỉnh" : "Lưu buổi"}</button></form></section>`;
    document.querySelector("#create").addEventListener("input", () => {
      preview = null;
      document.querySelector("#save").disabled = true;
      document.querySelector("#preview-result").textContent =
        "Dữ liệu thay đổi, cần xem lại bảng chia.";
    });
    document.querySelector("#preview").onclick = () =>
      guarded(async () => {
        const values = input(),
          result = await request({ op: "preview", ...values });
        preview = JSON.stringify(values);
        document.querySelector("#preview-result").innerHTML = result.shares
          .map(
            (p) =>
              `<p class="row"><span>${escape(name(p.memberId))}</span><strong>${money(p.amount)}</strong></p>`,
          )
          .join("");
        document.querySelector("#save").disabled = false;
      });
    document.querySelector("#create").onsubmit = (event) => {
      event.preventDefault();
      guarded(async () => {
        const values = input();
        if (preview !== JSON.stringify(values))
          throw Error("Hãy xem lại bảng chia.");
        await request({
          op: editing ? "adjust" : "create",
          sid: editing?.id,
          revision: editing?.revision,
          key: crypto.randomUUID(),
          ...values,
        });
        editing = null;
        await load();
        message.textContent = "Đã lưu dữ liệu giả lập.";
      });
    };
  }
  for (const session of [...state.sessions].reverse()) {
    const section = document.createElement("section");
    section.innerHTML = `<h2>${escape(session.title)}</h2><p>Tổng ${money(session.amount)} · Lần cập nhật ${session.revision}</p>${session.shares.map((p) => `<p class="row"><span>${escape(name(p.memberId))}</span><strong>${money(p.amount)}</strong></p>`).join("")}<h3>Thanh toán</h3>`;
    if (!session.payments.length)
      section.innerHTML += "<p>Không có khoản cần chuyển.</p>";
    for (const payment of session.payments) {
      const row = document.createElement("div");
      row.innerHTML = `<p>${escape(name(payment.from))} → ${escape(name(payment.to))}: <strong>${money(payment.amount)}</strong> · ${{ pending: "Chưa chuyển", marked_paid: "Đã báo chuyển", confirmed: "Đã nhận" }[payment.status]}</p>`;
      const op =
        payment.from === actor.value && payment.status === "pending"
          ? "mark"
          : payment.to === actor.value && payment.status === "marked_paid"
            ? "confirm"
            : null;
      if (op) {
        const button = document.createElement("button");
        button.textContent = op === "mark" ? "Tôi đã chuyển" : "Đã nhận";
        button.onclick = () =>
          guarded(async () => {
            button.disabled = true;
            try {
              await request({
                op,
                sid: session.id,
                revision: session.revision,
                payment: payment.id,
                key: crypto.randomUUID(),
              });
              await load();
            } finally {
              button.disabled = false;
            }
          });
        row.append(button);
      }
      section.append(row);
    }
    if (session.collector === actor.value) {
      const button = document.createElement("button");
      button.textContent = "Điều chỉnh tiền / người tham gia";
      button.onclick = () => {
        editing = session;
        load().then(() => window.scrollTo(0, 0));
      };
      section.append(button);
    }
    content.append(section);
  }
  const log = document.createElement("section");
  log.innerHTML = "<h2>Lịch sử giả lập</h2>";
  for (const event of state.history) {
    const p = document.createElement("p");
    p.textContent = `${name(event.actor)} · ${event.op} · buổi ${event.session}`;
    log.append(p);
  }
  content.append(log);
}
async function guarded(fn) {
  message.textContent = "";
  try {
    await fn();
  } catch (error) {
    message.textContent = error.message;
  }
}
actor.onchange = () => {
  editing = null;
  guarded(load);
};
await guarded(load);
