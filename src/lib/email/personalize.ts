import type { Buyer } from "@/lib/types";

export interface PersonalizationContext {
  first_name: string;
  last_name: string;
  company: string;
  country: string;
  product: string;
  greeting: string;
}

export function buildContext(buyer: Buyer | null, product = "Guntur Dry Red Chilli"): PersonalizationContext {
  const first = (buyer?.firstName ?? "").trim();
  const last = (buyer?.lastName ?? "").trim();
  const company = (buyer?.company ?? "").trim();
  const country = (buyer?.country ?? "").trim();
  const productInterest = buyer?.productInterest?.trim() || product;
  const greeting = first ? `Hi ${first}` : "Hello";
  return {
    first_name: first,
    last_name: last,
    company,
    country,
    product: productInterest,
    greeting,
  };
}

export function personalize(input: string, ctx: PersonalizationContext): string {
  if (!input) return "";
  return input.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (match, key: string) => {
    const k = key.toLowerCase() as keyof PersonalizationContext;
    const v = ctx[k];
    if (typeof v === "string" && v.length > 0) return v;
    // graceful fallbacks
    switch (k) {
      case "first_name":
        return "";
      case "greeting":
        return "Hello";
      case "company":
        return "your team";
      default:
        return "";
    }
  });
}

export function detectUnresolvedTokens(html: string): string[] {
  const matches = html.match(/\{\{\s*[a-z_]+\s*\}\}/gi);
  return matches ? Array.from(new Set(matches)) : [];
}
