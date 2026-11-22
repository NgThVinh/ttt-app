import { it, expect } from "vitest";
import { isReceiptImage } from "./receipt-image";
it("rejects HTML, SVG and short data instead of trusting the declared MIME", () => {
  for (const v of ["<svg onload=alert(1)>", "<html>not an image</html>", "abc"])
    expect(isReceiptImage(new TextEncoder().encode(v))).toBe(false);
});
it("recognizes JPEG, PNG and WebP signatures", () => {
  expect(
    isReceiptImage(
      new Uint8Array([255, 216, 255, 224, 0, 0, 0, 0, 0, 0, 0, 0]),
    ),
  ).toBe(true);
  expect(
    isReceiptImage(
      new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]),
    ),
  ).toBe(true);
  expect(isReceiptImage(new TextEncoder().encode("RIFF1234WEBPdata"))).toBe(
    true,
  );
});
