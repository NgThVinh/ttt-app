import { it, expect } from "vitest";
import { explicitAmounts, paymentReference } from "./payment-reference";
const row = {
  id: "11111111-1111-4111-8111-111111111111",
  amount: "85000",
  status: "pending",
  from_name: "Bình",
  to_name: "An",
  ref_code: "ABC234",
};
it("parses Vietnamese amounts exactly without floating point", () => {
  for (const text of ["85k", "85 nghìn", "85.000đ", "85,000 VND", "85000đ"])
    expect(explicitAmounts(text)).toEqual(["85000"]);
  expect(explicitAmounts("1tr2")).toEqual(["1200000"]);
  expect(explicitAmounts("1,5 triệu")).toEqual(["1500000"]);
  expect(explicitAmounts("19 giờ thứ 5")).toEqual([]);
  expect(explicitAmounts("-85k")).toEqual([]);
  expect(explicitAmounts("-1tr2")).toEqual([]);
});
it("requires a unique exact amount/name or payment reference", () => {
  expect(paymentReference("Tôi đã chuyển An 85k", [row], "mark_paid")?.id).toBe(
    row.id,
  );
  expect(paymentReference("Tôi đã chuyển An 50k", [row], "mark_paid")).toBe(
    null,
  );
  expect(paymentReference("Tôi đã chuyển tiền", [row], "mark_paid")).toBe(null);
  expect(
    paymentReference(
      "Tôi chuyển An 85k",
      [row, { ...row, id: "22222222-2222-4222-8222-222222222222" }],
      "mark_paid",
    ),
  ).toBe(null);
  expect(
    paymentReference("Tôi chuyển 85k mã 3T-ABC234", [row], "mark_paid")?.id,
  ).toBe(row.id);
  expect(paymentReference("An 85k hay 50k", [row], "mark_paid")).toBe(null);
  expect(
    paymentReference("Tôi chuyển -85k mã 3T-ABC234", [row], "mark_paid"),
  ).toBe(null);
});
it("keeps receiver confirmation separate and refuses already confirmed payments", () => {
  expect(
    paymentReference("Tôi nhận Bình 85k", [row], "confirm_received")?.id,
  ).toBe(row.id);
  expect(paymentReference("Tôi nhận An 85k", [row], "confirm_received")).toBe(
    null,
  );
  expect(
    paymentReference(
      "Tôi nhận Bình 85k",
      [{ ...row, status: "confirmed" }],
      "confirm_received",
    ),
  ).toBe(null);
  expect(paymentReference("Thanh chuyển 85k", [row], "mark_paid")).toBe(null);
});
