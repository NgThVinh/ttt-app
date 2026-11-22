export const RECEIPT_MAX_BYTES = 2 * 1024 * 1024;
export function isReceiptImage(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 12 &&
    ((bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) ||
      (bytes[0] === 137 &&
        bytes[1] === 80 &&
        bytes[2] === 78 &&
        bytes[3] === 71 &&
        bytes[4] === 13 &&
        bytes[5] === 10 &&
        bytes[6] === 26 &&
        bytes[7] === 10) ||
      (String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
        String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"))
  );
}
