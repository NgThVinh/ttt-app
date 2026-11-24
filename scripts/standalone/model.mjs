import { readFileSync } from "node:fs";
import ts from "typescript";

// Compile the actual app's pure functions in memory; no Next, env or database.
function source(name, replacements = {}) {
  let code = ts.transpileModule(
    readFileSync(new URL(`../../src/lib/${name}.ts`, import.meta.url), "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText;
  for (const [from, to] of Object.entries(replacements))
    code = code.replace(`from "${from}"`, `from "${to}"`);
  return "data:text/javascript;base64," + Buffer.from(code).toString("base64");
}
const moneyUrl = source("money");
const { reconcile } = await import(moneyUrl);
const { splitExpense, balances } = await import(
  source("expense-calculation", { "./money": moneyUrl })
);
const { courtInputSchema, weightInputSchema } = await import(
  source("number-input", { zod: import.meta.resolve("zod") })
);

export class Sandbox {
  constructor() {
    this.reset();
  }
  reset() {
    this.members = [
      { id: "a", name: "An · Admin", role: "admin" },
      { id: "b", name: "Bình · Thành viên", role: "member" },
      { id: "c", name: "Chi · Thành viên", role: "member" },
    ];
    this.sessions = [];
    this.history = [];
    this.requests = new Map();
    this.sequence = 0;
  }
  member(actor) {
    const member = this.members.find((m) => m.id === actor);
    if (!member) throw Error("Bạn chưa được mời vào nhóm.");
    return member;
  }
  state(actor) {
    if (!this.members.some((m) => m.id === actor))
      return { blocked: true, members: [], sessions: [], history: [] };
    return {
      blocked: false,
      members: this.members,
      sessions: this.sessions,
      history: this.history,
    };
  }
  calculate(amount, people, collector) {
    const raw = BigInt(courtInputSchema.parse(amount));
    if (
      !Array.isArray(people) ||
      !people.length ||
      new Set(people.map((p) => p.id)).size !== people.length
    )
      throw Error("Chọn người tham gia hợp lệ.");
    const members = people.map((p) => ({
      id: this.member(p.id).id,
      value: weightInputSchema.parse(p.value),
    }));
    if (!members.some((m) => m.id === collector))
      throw Error("Người tính tiền phải tham gia trong mô hình giả lập này.");
    const cost = splitExpense(raw, "total", "weighted", members, collector);
    return {
      amount: raw.toString(),
      people: members,
      shares: cost.shares,
      net: balances([{ ...cost, payer: collector }]),
    };
  }
  command(actor, input) {
    this.member(actor);
    if (input.op === "preview")
      return this.calculate(input.amount, input.people, actor);
    if (typeof input.key !== "string" || !input.key)
      throw Error("Thiếu mã yêu cầu.");
    const key = actor + ":" + input.key;
    const signature = JSON.stringify(input);
    const previous = this.requests.get(key);
    if (previous) {
      if (previous.signature !== signature)
        throw Error("Mã yêu cầu đã dùng với nội dung khác.");
      return previous.result;
    }
    let result;
    if (input.op === "create") {
      const title =
        typeof input.title === "string" ? input.title.trim().slice(0, 160) : "";
      if (!title) throw Error("Nhập tên buổi.");
      const calc = this.calculate(input.amount, input.people, actor);
      const session = {
        id: String(++this.sequence),
        title,
        collector: actor,
        revision: 1,
        ...calc,
        confirmed: [],
        payments: [],
      };
      session.payments = reconcile(calc.net, [], actor).map((p, i) => ({
        ...p,
        id: `${session.id}:1:${i}`,
        status: "pending",
      }));
      this.sessions.push(session);
      result = { id: session.id };
    } else {
      const session = this.sessions.find((s) => s.id === input.sid);
      if (!session) throw Error("Không tìm thấy buổi.");
      if (session.revision !== input.revision)
        throw Error("Buổi đã thay đổi. Hãy xem lại dữ liệu hiện tại.");
      if (input.op === "adjust") {
        if (session.collector !== actor)
          throw Error("Chỉ người tính tiền sửa bảng chia trong sandbox.");
        const calc = this.calculate(input.amount, input.people, actor);
        if (
          JSON.stringify(
            [...calc.people].sort((a, b) => a.id.localeCompare(b.id)),
          ) !==
          JSON.stringify(
            [...session.people].sort((a, b) => a.id.localeCompare(b.id)),
          )
        )
          throw Error(
            "Buổi đã chốt chi phí; danh sách và hệ số tham gia đã khóa.",
          );
        const payments = reconcile(calc.net, session.confirmed, actor).map(
          (p, i) => ({
            ...p,
            id: `${session.id}:${session.revision + 1}:${i}`,
            status: "pending",
          }),
        );
        Object.assign(session, calc, {
          payments: [
            ...session.payments.filter((p) => p.status === "confirmed"),
            ...payments,
          ],
        });
      } else {
        const payment = session.payments.find((p) => p.id === input.payment);
        if (!payment) throw Error("Khoản tiền đã thay đổi.");
        if (input.op === "mark") {
          if (payment.from !== actor || payment.status !== "pending")
            throw Error("Chỉ người chuyển được báo đã chuyển.");
          payment.status = "marked_paid";
        } else if (input.op === "confirm") {
          if (payment.to !== actor || payment.status !== "marked_paid")
            throw Error("Chỉ người nhận được xác nhận sau khi báo chuyển.");
          payment.status = "confirmed";
          session.confirmed.push({
            from: payment.from,
            to: payment.to,
            amount: payment.amount,
          });
        } else throw Error("Thao tác không được hỗ trợ.");
      }
      session.revision++;
      result = { id: session.id };
    }
    this.history.push({ actor, op: input.op, session: result.id });
    this.requests.set(key, { signature, result });
    return result;
  }
}
