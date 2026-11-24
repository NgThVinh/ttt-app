import { describe, expect, it } from "vitest";
import { banks, bankForBin, bankLabel, searchBanks } from "./banks";

describe("bank selection", () => {
  it("has one unambiguous six-digit BIN per catalog entry", () => {
    expect(new Set(banks.map((b) => b.bin)).size).toBe(banks.length);
    expect(banks.every((b) => /^\d{6}$/.test(b.bin))).toBe(true);
    expect(bankForBin("970436")?.code).toBe("VCB");
    expect(bankForBin("970422")?.code).toBe("MB");
  });
  it("matches Vietnamese names without accents and abbreviations", () => {
    expect(searchBanks("ngoai thuong")[0].bin).toBe("970436");
    expect(searchBanks("QUÂN ĐỘI")[0].bin).toBe("970422");
    expect(searchBanks("VCB")[0].bin).toBe("970436");
  });
  it("ranks exact MB before words containing mb, such as Vietcombank", () => {
    expect(searchBanks("MB")[0].bin).toBe("970422");
    expect(searchBanks("MB Bank")[0].bin).toBe("970422");
    expect(searchBanks("viet com bank")[0].bin).toBe("970436");
  });
  it("keeps the current and previous BVBank brands searchable", () => {
    expect(searchBanks("BVBank")[0].bin).toBe("970454");
    expect(searchBanks("VietCapitalBank")[0].bin).toBe("970454");
    expect(bankLabel("970454")).toBe("BVBank");
    expect(searchBanks("VCBNeo")[0].bin).toBe("970444");
    expect(searchBanks("CBBank")[0].bin).toBe("970444");
    expect(searchBanks("Đông Á")[0].bin).toBe("970406");
  });
  it("does not substitute another bank for an unknown saved code or invalid search", () => {
    expect(bankForBin("000000")).toBeUndefined();
    expect(bankLabel("000000")).toContain("000000");
    expect(searchBanks("ngan hang khong ton tai xyz")).toEqual([]);
    expect(searchBanks("???")).toEqual([]);
  });
});
