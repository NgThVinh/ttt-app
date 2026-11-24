import catalog from "@/data/banks.json";

export type Bank = (typeof catalog.banks)[number];
const popular = [
  "970436",
  "970422",
  "970407",
  "970418",
  "970416",
  "970405",
  "970415",
  "970432",
  "970423",
];
// BVBank's current brand: https://bvbank.net.vn/; keep the provider's old brand searchable.
const brands: Record<string, string> = {
  "970454": "BVBank",
  "970444": "VCBNeo",
};
const aliases: Record<string, string[]> = {
  "970454": ["BVBank", "VietCapitalBank", "Bản Việt"],
  "970444": ["VCBNeo", "CBBank", "CB", "Ngân hàng Xây dựng"],
  "970406": ["DongABank", "Đông Á"],
};
export const bankName = (bank: Bank) => brands[bank.bin] || bank.shortName;
export const banks = [...catalog.banks].sort((a, b) => {
  const rank = (bin: string) =>
    popular.includes(bin) ? popular.indexOf(bin) : popular.length;
  return (
    rank(a.bin) - rank(b.bin) || bankName(a).localeCompare(bankName(b), "vi")
  );
});
export const bankForBin = (bin?: string | null) =>
  banks.find((bank) => bank.bin === bin);
export const bankLabel = (bin?: string | null) => {
  const bank = bankForBin(bin);
  return bank ? bankName(bank) : bin ? `Ngân hàng đã lưu (${bin})` : "";
};
const normalize = (value: string) =>
  value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replaceAll("đ", "d")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
export function searchBanks(query: string, list: Bank[] = banks) {
  const normalized = normalize(query);
  if (query.trim() && !normalized) return [];
  const words = normalized.split(/\s+/).filter(Boolean);
  const rank = (bank: Bank) => {
    const code = normalize(bank.code);
    const names = [
      bankName(bank),
      bank.shortName,
      ...(aliases[bank.bin] || []),
    ].map((name) => normalize(name).replaceAll(" ", ""));
    const term = normalized.replaceAll(" ", "");
    return term && (code === term || names.includes(term))
      ? 0
      : term &&
          (code.startsWith(term) || names.some((name) => name.startsWith(term)))
        ? 1
        : 2;
  };
  return list
    .filter((bank) => {
      const text = normalize(
        `${bankName(bank)} ${bank.shortName} ${bank.code} ${bank.name} ${bank.bin} ${(aliases[bank.bin] || []).join(" ")}`,
      );
      return words.every((word) => text.includes(word));
    })
    .sort((a, b) => rank(a) - rank(b));
}
