import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { z } from "zod";
const envelopeSchema = z.object({
  version: z.literal(1),
  iv: z.string(),
  tag: z.string(),
  ciphertext: z.string(),
});
function key(secret: string) {
  if (secret.length < 32) throw Error("AI encryption secret is too short");
  return createHash("sha256").update(secret).digest();
}
export function encryptGroupKey(
  group: string,
  plaintext: string,
  secret: string,
) {
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", key(secret), iv);
  cipher.setAAD(Buffer.from(`3t:ai-key:v1:${group}`));
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  return {
    version: 1 as const,
    iv: iv.toString("base64url"),
    tag: cipher.getAuthTag().toString("base64url"),
    ciphertext: ciphertext.toString("base64url"),
  };
}
export function decryptGroupKey(group: string, value: unknown, secret: string) {
  const envelope = envelopeSchema.parse(value),
    decipher = createDecipheriv(
      "aes-256-gcm",
      key(secret),
      Buffer.from(envelope.iv, "base64url"),
    );
  decipher.setAAD(Buffer.from(`3t:ai-key:v1:${group}`));
  decipher.setAuthTag(Buffer.from(envelope.tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}
