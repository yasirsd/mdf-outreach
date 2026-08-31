/** Sanitize a provider-returned phone string. No verification claim. */

export const PHONE_NUMBER_MAX_LENGTH = 40;

function hasControlChars(value: string): boolean {
  return /[\u0000-\u001f\u007f]/.test(value) || /[\r\n\0]/.test(value);
}

export function sanitizePhoneNumber(value: string | null | undefined): string | undefined {
  const raw = (value ?? "").trim();
  if (!raw) return undefined;
  if (raw.length > PHONE_NUMBER_MAX_LENGTH) return undefined;
  if (hasControlChars(raw)) return undefined;
  return raw;
}
