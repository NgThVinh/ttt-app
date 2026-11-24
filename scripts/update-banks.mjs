import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
const source = "https://api.vietqr.io/v2/banks";
const response = await fetch(source, { signal: AbortSignal.timeout(15000) });
if (!response.ok) throw Error("BANK_CATALOG_FETCH_FAILED");
const payload = await response.json();
if (
  payload.code !== "00" ||
  !Array.isArray(payload.data) ||
  payload.data.length < 40
)
  throw Error("BANK_CATALOG_INVALID");
const banks = payload.data.map(({ bin, code, name, shortName }) => {
  if (
    typeof bin !== "string" ||
    !/^\d{6}$/.test(bin) ||
    [code, name, shortName].some((s) => typeof s !== "string" || !s.trim())
  )
    throw Error("BANK_ENTRY_INVALID");
  return {
    bin,
    code: code.trim(),
    name: name.trim().normalize("NFC"),
    shortName: shortName.trim(),
  };
});
if (
  new Set(banks.map((b) => b.bin)).size !== banks.length ||
  !banks.some((b) => b.bin === "970436" && b.code === "VCB") ||
  !banks.some((b) => b.bin === "970422" && b.code === "MB")
)
  throw Error("BANK_CATALOG_MAPPING_CHANGED");
mkdirSync(fileURLToPath(new URL("../src/data/", import.meta.url)), {
  recursive: true,
});
writeFileSync(
  fileURLToPath(new URL("../src/data/banks.json", import.meta.url)),
  JSON.stringify(
    { source, checkedAt: new Date().toISOString().slice(0, 10), banks },
    null,
    2,
  ) + "\n",
);
console.log(
  JSON.stringify({ source, banks: banks.length, privateDataSent: false }),
);
