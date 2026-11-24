import { expect, it } from "vitest";
import { Sandbox } from "../../scripts/standalone/model.mjs";

it("ordinary sandbox members may create but only the collector changes costs, with attendees locked", () => {
  const model = new Sandbox();
  const people = [
    { id: "a", value: "1" },
    { id: "b", value: "1" },
  ];
  model.command("b", {
    op: "create",
    key: "b-create",
    title: "Member session",
    amount: "100000",
    people,
  });
  const sid = model.sessions![0].id;
  expect(() =>
    model.command("a", {
      op: "adjust",
      sid,
      revision: 1,
      key: "admin",
      amount: "50000",
      people,
    }),
  ).toThrow("người tính tiền");
  expect(() =>
    model.command("b", {
      op: "adjust",
      sid,
      revision: 1,
      key: "change-people",
      amount: "50000",
      people: [{ id: "b", value: "1" }],
    }),
  ).toThrow("đã khóa");
});

it("keeps confirmed transfers and reconciles refunds after adjustment", () => {
  const model = new Sandbox();
  const people = [
    { id: "a", value: "1" },
    { id: "b", value: "1" },
  ];
  const create = {
    op: "create",
    key: "create",
    title: "Test",
    amount: "100.000",
    people,
  };
  model.command("a", create);
  model.command("a", create);
  expect(model.sessions).toHaveLength(1);
  const sid = model.sessions![0].id,
    payment = model.sessions![0].payments[0].id;
  expect(() =>
    model.command("a", {
      op: "mark",
      sid,
      payment,
      revision: 1,
      key: "invalid",
    }),
  ).toThrow("người chuyển");
  model.command("b", { op: "mark", sid, payment, revision: 1, key: "mark" });
  expect(() =>
    model.command("a", {
      op: "confirm",
      sid,
      payment,
      revision: 1,
      key: "old",
    }),
  ).toThrow("thay đổi");
  model.command("a", {
    op: "confirm",
    sid,
    payment,
    revision: 2,
    key: "confirm",
  });
  model.command("a", {
    op: "adjust",
    sid,
    revision: 3,
    key: "adjust",
    amount: "50,000",
    people,
  });
  expect(model.sessions![0].payments).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ status: "confirmed", amount: 50000n }),
      expect.objectContaining({
        status: "pending",
        from: "a",
        to: "b",
        amount: 25000n,
      }),
    ]),
  );
  expect(() => model.command("a", { ...create, amount: "1" })).toThrow(
    "nội dung khác",
  );
  expect(() => model.command("x", create)).toThrow("chưa được mời");
  expect(model.state("x").sessions).toEqual([]);
});
