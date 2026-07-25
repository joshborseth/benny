import { createHash, createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export type EncryptedPayload = {
  ciphertext: string;
  iv: string;
};

export type SiteCredentials = {
  username: string;
  password: string;
};

function requireKeyMaterial(): string {
  const key = process.env.CREDENTIALS_ENCRYPTION_KEY;
  if (!key || key.length < 16) {
    throw new Error("CREDENTIALS_ENCRYPTION_KEY must be set (min 16 characters) in worker env");
  }
  return key;
}

/** Match Convex Web Crypto helper: AES-256-GCM key = SHA-256(keyMaterial). */
function deriveKey(): Buffer {
  return createHash("sha256").update(requireKeyMaterial(), "utf8").digest();
}

export function decryptJson<T>(payload: EncryptedPayload): T {
  const key = deriveKey();
  const iv = Buffer.from(payload.iv, "base64");
  const ciphertext = Buffer.from(payload.ciphertext, "base64");
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  // Web Crypto AES-GCM appends the 16-byte auth tag to the ciphertext
  const tag = ciphertext.subarray(ciphertext.length - 16);
  const data = ciphertext.subarray(0, ciphertext.length - 16);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(data), decipher.final()]);
  return JSON.parse(plaintext.toString("utf8")) as T;
}

/** Used only in tests / local tooling — Convex encrypts on write. */
export function encryptJson(value: unknown): EncryptedPayload {
  const key = deriveKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const plaintext = Buffer.from(JSON.stringify(value), "utf8");
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    ciphertext: Buffer.concat([encrypted, tag]).toString("base64"),
    iv: iv.toString("base64"),
  };
}
