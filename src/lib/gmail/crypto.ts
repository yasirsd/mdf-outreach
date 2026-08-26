import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { requireGmailTokenEncryptionKey } from "./config";

/**
 * AES-256-GCM authenticated encryption for Gmail OAuth tokens at rest.
 *
 * Key material is derived from GMAIL_TOKEN_ENCRYPTION_KEY (a dedicated
 * server-only secret) via SHA-256, NOT from APP_SESSION_SECRET. This
 * isolation means:
 *
 *   - rotating APP_SESSION_SECRET does not invalidate Gmail connections
 *   - rotating GMAIL_TOKEN_ENCRYPTION_KEY does not sign out MDF users
 *   - a compromise of one secret does not automatically compromise the
 *     other's protected data
 *
 * Rotating GMAIL_TOKEN_ENCRYPTION_KEY invalidates every stored Gmail
 * connection — operators must reconnect Gmail after such a rotation.
 * That is the deliberate behavior.
 */

function key(): Buffer {
  return createHash("sha256").update(requireGmailTokenEncryptionKey()).digest();
}

export interface EncryptedField {
  ciphertext: string;
  iv: string;
  tag: string;
}

export function encryptString(plain: string): EncryptedField {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    ciphertext: enc.toString("base64"),
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
  };
}

export function decryptString(field: EncryptedField): string {
  const iv = Buffer.from(field.iv, "base64");
  const tag = Buffer.from(field.tag, "base64");
  const enc = Buffer.from(field.ciphertext, "base64");
  const decipher = createDecipheriv("aes-256-gcm", key(), iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
  return dec.toString("utf8");
}
