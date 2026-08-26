import { randomBytes } from "node:crypto";

export interface MimeInput {
  fromName: string;
  fromEmail: string;
  to: string;
  replyTo?: string;
  subject: string;
  html: string;
  text: string;
}

/**
 * RFC-5322 multipart/alternative message, base64url-encoded for the
 * Gmail API `users.messages.send` `raw` field. Every message we send
 * contains BOTH a text/plain and a text/html body — Gmail deliverability
 * expects it and buyer clients that block HTML still see the plain text.
 */
export function buildMimeRaw(input: MimeInput): string {
  const boundary = `----=_Part_${randomBytes(12).toString("hex")}`;
  const fromHeader = formatAddress(input.fromEmail, input.fromName);
  const headers: string[] = [
    "MIME-Version: 1.0",
    `From: ${fromHeader}`,
    `To: ${input.to}`,
  ];
  if (input.replyTo) headers.push(`Reply-To: ${input.replyTo}`);
  headers.push(`Subject: ${encodeHeaderIfNeeded(input.subject)}`);
  headers.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);

  const parts = [
    "--" + boundary,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: quoted-printable",
    "",
    quotedPrintable(input.text),
    "",
    "--" + boundary,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: quoted-printable",
    "",
    quotedPrintable(input.html),
    "",
    `--${boundary}--`,
    "",
  ];

  const message = [...headers, "", ...parts].join("\r\n");
  return base64UrlEncode(Buffer.from(message, "utf8"));
}

export function base64UrlEncode(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function formatAddress(email: string, name: string): string {
  if (!name) return email;
  // Simple RFC-2047 encoding for the display name if non-ASCII.
  const needsEncoding = /[^\x20-\x7E]/.test(name);
  const safe = needsEncoding
    ? `=?UTF-8?B?${Buffer.from(name, "utf8").toString("base64")}?=`
    : name.replace(/"/g, '\\"');
  return `"${safe}" <${email}>`;
}

function encodeHeaderIfNeeded(v: string): string {
  if (!/[^\x20-\x7E]/.test(v)) return v;
  return `=?UTF-8?B?${Buffer.from(v, "utf8").toString("base64")}?=`;
}

/**
 * Quoted-printable per RFC 2045. Keeps line length <= 76 and handles UTF-8.
 * Adequate for HTML bodies of our size; a full production QP encoder is
 * unnecessary at this volume.
 */
export function quotedPrintable(input: string): string {
  const bytes = Buffer.from(input, "utf8");
  const out: string[] = [];
  let line = "";
  const flushLine = () => {
    out.push(line);
    line = "";
  };
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    let s: string;
    if (b === 0x0d) continue; // \r — normalize to \n below
    if (b === 0x0a) {
      flushLine();
      continue;
    }
    if (b === 0x20 || b === 0x09) {
      // Encode trailing whitespace at end of line — otherwise pass through.
      const next = bytes[i + 1];
      if (next === 0x0a || next === undefined) {
        s = `=${b.toString(16).toUpperCase().padStart(2, "0")}`;
      } else {
        s = String.fromCharCode(b);
      }
    } else if (b === 0x3d /* = */ || b < 32 || b > 126) {
      s = `=${b.toString(16).toUpperCase().padStart(2, "0")}`;
    } else {
      s = String.fromCharCode(b);
    }
    if (line.length + s.length > 75) {
      out.push(line + "=");
      line = "";
    }
    line += s;
  }
  if (line.length > 0) out.push(line);
  return out.join("\r\n");
}
