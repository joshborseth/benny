/** AES-256-GCM helpers using Web Crypto (works in Convex runtime and Node). */

function requireKeyMaterial(): string {
  const key = process.env.CREDENTIALS_ENCRYPTION_KEY;
  if (!key || key.length < 16) {
    throw new Error(
      "CREDENTIALS_ENCRYPTION_KEY must be set (min 16 characters) in Convex env and worker env",
    );
  }
  return key;
}

function bufferToBase64(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function deriveAesKey(keyMaterial: string): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(keyMaterial));
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export type EncryptedPayload = {
  ciphertext: string;
  iv: string;
};

export async function encryptJson(value: unknown): Promise<EncryptedPayload> {
  const key = await deriveAesKey(requireKeyMaterial());
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(value));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext);
  return {
    ciphertext: bufferToBase64(ciphertext),
    iv: bufferToBase64(iv),
  };
}

export async function decryptJson<T>(payload: EncryptedPayload): Promise<T> {
  const key = await deriveAesKey(requireKeyMaterial());
  const iv = base64ToBytes(payload.iv);
  const ciphertext = base64ToBytes(payload.ciphertext);
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    key,
    ciphertext as BufferSource,
  );
  return JSON.parse(new TextDecoder().decode(plaintext)) as T;
}

export type SiteCredentials = {
  username: string;
  password: string;
};
