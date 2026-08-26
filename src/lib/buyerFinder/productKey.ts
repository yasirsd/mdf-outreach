import { isProductKey } from "@/lib/email/themes/catalogue";
import type { ProductKey } from "@/lib/email/themes/types";

/** Reuses the existing MDF ProductKey catalogue. Does not define a second vocabulary. */
export function requireProductKey(value: string | null | undefined): ProductKey {
  if (!isProductKey(value)) {
    throw new Error(`Invalid MDF product key: ${value ?? "(empty)"}`);
  }
  return value;
}
