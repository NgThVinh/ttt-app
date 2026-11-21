/** Production Quick Links require an operator-owned template (VietQR Oct 2026). */
export function vietQrUrl(
  bin: string,
  account: string,
  amount: string,
  reference: string,
  name: string,
  template: string,
): string | null {
  if (
    !/^\d{6}$/.test(bin) ||
    !/^[A-Za-z0-9]{4,19}$/.test(account) ||
    !/^\d{1,13}$/.test(amount) ||
    BigInt(amount) <= 0n ||
    !/^[A-Za-z0-9_-]{1,80}$/.test(template) ||
    !/^[A-Z2-9]{6}$/.test(reference)
  )
    return null;
  return `https://img.vietqr.io/image/${bin}-${account}-${template}.svg?${new URLSearchParams({ amount, addInfo: `3T-${reference}`, accountName: name })}`;
}
