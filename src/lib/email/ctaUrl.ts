import type { Campaign, EmailTemplate } from "@/lib/types";
import { effectiveSections } from "./effectiveSections";

/**
 * MDF Outreach — F8 CTA URL contract.
 *
 * The renderer historically fell back to `href="#"` whenever a CTA button
 * was rendered without a configured URL. That was safe in preview mode
 * but never acceptable for a real send: an email that ships with
 * `href="#"` looks like a broken link to the buyer and damages
 * deliverability reputation.
 *
 * CONTRACT
 *   • VISIBLE CTA BUTTON  → CTA URL MUST be a valid absolute HTTP / HTTPS
 *                           URL. `mailto:` and `tel:` are also accepted
 *                           because those are legitimate commercial
 *                           destinations MDF operators may use.
 *   • HIDDEN / ABSENT CTA → CTA URL is not required and must NOT block.
 *
 * The renderer stays permissive (it still emits `href="#"` in editor
 * previews so operators can see how the button will look). PRODUCTION
 * send is blocked at preflight time by `assertCtaUrlsValidForSend`,
 * which is wired into `fullPreflight`.
 */

const REJECTED_PROTOCOLS = /^(javascript|vbscript|data|blob|file|ftp):/i;
const ACCEPTED_PROTOCOLS = /^(https?|mailto|tel):/i;

/**
 * Returns true when the URL is a legitimate absolute destination suitable
 * for a production email button.
 *
 * Explicitly accepted: `http://`, `https://`, `mailto:`, `tel:`, plus
 * WhatsApp `https://wa.me/…` (matches the `https?` branch).
 *
 * Explicitly rejected: empty string, `#`, `javascript:`, `data:`, `blob:`,
 * relative paths, localhost, and any URL that fails Node's URL parser.
 */
export function isValidCtaUrl(input: unknown): boolean {
  if (typeof input !== "string") return false;
  const raw = input.trim();
  if (!raw) return false;
  if (raw === "#") return false;
  if (REJECTED_PROTOCOLS.test(raw)) return false;

  // For http(s), require an absolute URL with an actual host.
  if (/^https?:/i.test(raw)) {
    let parsed: URL;
    try {
      parsed = new URL(raw);
    } catch {
      return false;
    }
    if (parsed.hostname === "" || parsed.hostname === "localhost") return false;
    if (parsed.hostname === "127.0.0.1") return false;
    return true;
  }

  if (/^mailto:/i.test(raw)) {
    // `mailto:` must carry at least one recognisable address.
    const address = raw.slice(7).split("?")[0];
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address);
  }

  if (/^tel:/i.test(raw)) {
    // `tel:` must carry digits (allow +, spaces, dashes, parens).
    const number = raw.slice(4);
    return /^\+?[0-9 ()\-]{4,}$/.test(number);
  }

  return ACCEPTED_PROTOCOLS.test(raw);
}

export interface CtaFinding {
  section: "hero" | "packing" | "cta" | "direct-hero";
  reason: "missing" | "invalid";
  value: string;
  message: string;
}

/**
 * Return the CTA-related blockers a production send should report,
 * gated by which CTA buttons will actually render.
 *
 * The rule for "will actually render" mirrors the renderer:
 *
 *   Signature:
 *     hero    → renders a CTA when hero.visible AND hero.data.ctaLabel is set
 *     packing → renders a CTA when packing.visible AND packing.data.ctaLabel is set
 *     cta     → renders a CTA when cta.visible AND cta.data.ctaLabel is set
 *
 *   Direct:
 *     compact hero → renders a CTA when EITHER cta.visible/data.ctaLabel OR
 *                    hero.visible/data.ctaLabel supplied a label. URL falls
 *                    back to cta.data.ctaUrl → hero.data.ctaUrl.
 *
 * If no button is rendered, no CTA-URL blocker is emitted, even when the
 * URL is empty.
 */
export function preflightCtaUrls(
  template: EmailTemplate,
  campaign?: Pick<Campaign, "emailSections" | "templateVariant"> | null,
): CtaFinding[] {
  const findings: CtaFinding[] = [];
  const { sections, variant } = effectiveSections(template, campaign);

  const by = (type: string) =>
    sections.find((s) => s.type === type && s.visible !== false);

  if (variant === "direct") {
    // Direct button eligibility: label from cta OR hero (visible), URL from
    // cta OR hero.
    const hero = by("hero");
    const cta = by("cta");
    const label = (cta?.data.ctaLabel || hero?.data.ctaLabel || "").trim();
    if (label) {
      const url = (cta?.data.ctaUrl || hero?.data.ctaUrl || "").trim();
      pushIfBad(findings, url, "direct-hero", "Direct CTA");
    }
    return findings;
  }

  // Signature — check each CTA-emitting section independently.
  for (const type of ["hero", "packing", "cta"] as const) {
    const s = by(type);
    if (!s) continue;
    const label = (s.data.ctaLabel || "").trim();
    if (!label) continue;
    const url = (s.data.ctaUrl || "").trim();
    pushIfBad(findings, url, type, prettyLabel(type));
  }
  return findings;
}

function pushIfBad(
  out: CtaFinding[],
  url: string,
  section: CtaFinding["section"],
  label: string,
): void {
  if (!url) {
    out.push({
      section,
      reason: "missing",
      value: url,
      message: `${label} button has no destination URL.`,
    });
    return;
  }
  if (!isValidCtaUrl(url)) {
    out.push({
      section,
      reason: "invalid",
      value: url,
      // Wording matches the actual contract in isValidCtaUrl: absolute
      // http(s), mailto:, and tel: are all accepted destinations.
      message: `${label} button URL "${url}" is not a valid absolute web, email, or telephone link.`,
    });
  }
}

function prettyLabel(type: "hero" | "packing" | "cta"): string {
  if (type === "hero") return "Hero";
  if (type === "packing") return "Packing";
  return "Primary CTA";
}
