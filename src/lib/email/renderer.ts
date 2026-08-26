import type {
  AssetRecord,
  Buyer,
  EmailSection,
  EmailTemplate,
  WorkspaceSettings,
} from "@/lib/types";
import { buildContext, personalize, type PersonalizationContext } from "./personalize";
import { getProductTheme } from "@/lib/email/themes/registry";
import type { ProductKey, ProductPalette } from "@/lib/email/themes/types";

/*
 * MDF Email Renderer — modern rounded, flowing composition.
 *
 * Rules the renderer follows so the emails stay premium and deliverable:
 *   1. Table-based structural layout (Outlook / older Gmail safe).
 *   2. Inline CSS on every rendered node.
 *   3. Rounded corners via border-radius — a *pure enhancement*, all
 *      layouts remain correct with square fallback.
 *   4. Real HTML text for headlines, CTAs, product names, trust lines,
 *      footer — never bake essential words into an image.
 *   5. Decorative flow (wave dividers, big numbers, chips) is done with
 *      HTML + inline SVG so it degrades gracefully.
 *   6. No CSS grid, flexbox for critical layout, backdrop-blur, or
 *      clip-path anywhere structural.
 */

export interface RenderOptions {
  template: EmailTemplate;
  buyer: Buyer | null;
  settings: WorkspaceSettings;
  assetsBySlot: Record<string, AssetRecord | undefined>;
  productName?: string;
  /**
   * `preview` (default): use production URL when present, else fall back to
   *   local Base64 preview, else render the intentional placeholder.
   * `send`: never inline Base64. Only assets with a production URL AND
   *   `status === "production"` are eligible — everything else renders
   *   the placeholder. Used by the future live-send preflight.
   */
  mode?: "preview" | "send";
}

const FONT_STACK =
  "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";
const SERIF_STACK =
  "'Fraunces', Georgia, 'Times New Roman', serif";

const CONTAINER_WIDTH = 640;
const CONTAINER_INNER = 520; // narrower text column for comfortable reading

const DEFAULT_PALETTE: ProductPalette = {
  canvas: "#ECE7DB",
  paper: "#FAF8F4",
  paperText: "#1F1F1F",
  paperMuted: "#5A524C",
  surface: "#F2EFE9",
  surfaceText: "#1F1F1F",
  surfaceMuted: "#5A524C",
  darkSurface: "#151515",
  darkSurfaceText: "#FFFFFF",
  darkSurfaceMuted: "#C7C1B4",
  primary: "#A62921",
  accent: "#F36B21",
  accentText: "#0B0B0B",
  ctaBg: "#A62921",
  ctaText: "#FFFFFF",
  border: "#E6E1D9",
  // legacy aliases (keep in sync with the roles above)
  ink: "#151515",
  soft: "#F2EFE9",
  primaryDeep: "#7C1A16",
  text: "#1F1F1F",
  textMuted: "#5A524C",
  invertedText: "#FFFFFF",
  invertedMuted: "#C7C1B4",
};

/* -------------------------------------------------------------------- */
/*  Helpers                                                             */
/* -------------------------------------------------------------------- */

function esc(s: string): string {
  return (s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function nl2br(s: string): string {
  return esc(s).replace(/\n/g, "<br />");
}

// The renderer is fully synchronous, so a module-scoped mode set at the
// top of renderEmailHtml propagates deterministically through every
// nested renderer without threading it through 9 function signatures.
let currentRenderMode: "preview" | "send" = "preview";

function assetSrc(a: AssetRecord | undefined): string {
  if (!a) return "";
  const prod = a.productionUrl?.trim();
  if (currentRenderMode === "send") {
    // Live send: only production-status hosted URLs are eligible.
    if (prod && a.status === "production") return prod;
    return "";
  }
  return prod || a.localDataUrl || "";
}

function resolvePalette(template: EmailTemplate): ProductPalette {
  if (template.themeKey && isKnownProduct(template.themeKey)) {
    return getProductTheme(template.themeKey).palette;
  }
  return DEFAULT_PALETTE;
}

function isKnownProduct(key: string): key is ProductKey {
  return (
    key === "guntur-chilli" ||
    key === "banganapalli-mango" ||
    key === "pomegranate" ||
    key === "indian-apple"
  );
}

/* -------------------------------------------------------------------- */
/*  Primitives                                                          */
/* -------------------------------------------------------------------- */

/**
 * Outer email shell.
 *
 * Structure:
 *   <table bg=OUTER_BG> — inbox chrome
 *     <table width=CONTAINER_WIDTH bg=palette.paper radius=large> — email card
 *       …sections…
 */
function shellOpen(palette: ProductPalette): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="mdf-outer-shell" style="background-color:${palette.canvas};margin:0;padding:0;">
  <tr><td align="center" style="padding:24px 12px;">
    <!--[if mso | IE]>
    <table role="presentation" width="${CONTAINER_WIDTH}" cellpadding="0" cellspacing="0" border="0" align="center"><tr><td>
    <![endif]-->
    <table role="presentation" width="${CONTAINER_WIDTH}" cellpadding="0" cellspacing="0" border="0" bgcolor="${palette.paper}" style="width:${CONTAINER_WIDTH}px;max-width:${CONTAINER_WIDTH}px;background-color:${palette.paper};border-radius:24px;overflow:hidden;" class="mdf-container">`;
}
function shellClose(): string {
  return `</table>
    <!--[if mso | IE]>
    </td></tr></table>
    <![endif]-->
  </td></tr>
</table>`;
}

/**
 * Section wrapper — an inner padded band on the email card. Rounded
 * corners on inner surfaces (like heroes) are applied *inside* the band
 * rather than on this row.
 */
function band(content: string, bg: string, padY = 40, padX = 40): string {
  return `<tr><td style="background-color:${bg};padding:${padY}px ${padX}px;" class="mdf-pad">${content}</td></tr>`;
}

/**
 * Rounded inner surface — the modern "card inside a band" pattern.
 *
 * Background is put on the TD (both `bgcolor` attribute and inline
 * `background-color`) so it paints reliably across every renderer.
 * Putting background on the wrapping `<table>` alone is unreliable when
 * combined with `border-radius` / `overflow:hidden` — some engines drop
 * the fill entirely, which is what caused the pale-on-pale Mango Direct
 * regression.
 */
function surface(
  content: string,
  {
    bg,
    radius = 20,
    padY = 32,
    padX = 32,
    fg,
  }: { bg: string; radius?: number; padY?: number; padX?: number; fg?: string },
): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${bg}" style="background-color:${bg};border-radius:${radius}px;border-collapse:separate;">
    <tr><td bgcolor="${bg}" style="background-color:${bg};padding:${padY}px ${padX}px;border-radius:${radius}px;${fg ? `color:${fg};` : ""}">${content}</td></tr>
  </table>`;
}

/**
 * Bulletproof-ish button. Uses table wrapper + Outlook conditional VML.
 * Rounded corners on modern clients; square in classic Outlook (fine).
 */
function ctaButton(
  label: string,
  url: string,
  {
    bg,
    fg,
    radius = 14,
  }: { bg: string; fg: string; radius?: number },
): string {
  const safeUrl = url && url !== "#" ? url : "#";
  // Solid button. `border:0 solid ${bg}` collapses any default cell border
  // and paints the outline in the button colour so no lighter halo can
  // appear at the edge. The <a> carries its own border-radius so the
  // clickable target matches the visible surface exactly.
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto;border-collapse:separate;border-spacing:0;">
    <tr><td align="center" bgcolor="${bg}" style="background-color:${bg};border-radius:${radius}px;border:0 solid ${bg};mso-padding-alt:0;line-height:0;">
      <a href="${esc(safeUrl)}" target="_blank" rel="noopener" style="display:inline-block;padding:15px 28px;min-height:22px;font-family:${FONT_STACK};font-size:13.5px;font-weight:600;letter-spacing:0.08em;color:${fg};background-color:${bg};text-decoration:none;text-transform:uppercase;border-radius:${radius}px;line-height:1;outline:0;border:0 solid ${bg};">${esc(label)}</a>
    </td></tr>
  </table>`;
}

/** Small eyebrow tag — tracked, uppercase, tiny. */
function eyebrow(text: string, color: string): string {
  if (!text) return "";
  return `<div style="font-family:${FONT_STACK};font-size:11px;font-weight:600;letter-spacing:0.22em;color:${color};text-transform:uppercase;">${esc(text)}</div>`;
}

/** Serif display headline. */
function displayHeadline(html: string, color: string, size = 34): string {
  return `<h1 style="margin:0;font-family:${SERIF_STACK};font-weight:500;font-size:${size}px;line-height:1.08;letter-spacing:-0.02em;color:${color};">${html}</h1>`;
}

/** Sans headline — used inside cards. */
function sansHeadline(html: string, color: string, size = 26): string {
  return `<h2 style="margin:0;font-family:${FONT_STACK};font-weight:600;font-size:${size}px;line-height:1.18;letter-spacing:-0.01em;color:${color};">${html}</h2>`;
}

/** Comfortable body paragraph. */
function bodyText(
  html: string,
  color: string,
  { size = 16, maxWidth = 460 }: { size?: number; maxWidth?: number } = {},
): string {
  return `<p style="margin:0;font-family:${FONT_STACK};font-size:${size}px;line-height:1.65;color:${color};max-width:${maxWidth}px;">${html}</p>`;
}

function vspace(px: number): string {
  return `<div style="height:${px}px;line-height:${px}px;font-size:0;">&nbsp;</div>`;
}

/**
 * Soft image placeholder. Used when an approved production asset is not
 * yet available. Reads as an intentional design surface, not a broken
 * image slot.
 */
function imagePlaceholder(
  label: string,
  { bg, tint, radius = 20, height = 260 }: { bg: string; tint: string; radius?: number; height?: number },
): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${bg};border-radius:${radius}px;overflow:hidden;">
    <tr><td align="center" valign="middle" height="${height}" style="height:${height}px;padding:16px;">
      <div style="font-family:${FONT_STACK};font-size:10.5px;font-weight:600;letter-spacing:0.22em;text-transform:uppercase;color:${tint};margin-bottom:4px;">${esc(label)}</div>
      <div style="font-family:${FONT_STACK};font-size:12px;color:${tint};opacity:0.75;">Awaiting approved production asset</div>
    </td></tr>
  </table>`;
}

function heroImage(
  src: string,
  alt: string,
  { radius = 20, height = 320 }: { radius?: number; height?: number } = {},
): string {
  return `<img src="${esc(src)}" width="${CONTAINER_INNER}" alt="${esc(alt)}" style="display:block;width:100%;max-width:${CONTAINER_INNER}px;height:${height}px;object-fit:cover;border:0;border-radius:${radius}px;" />`;
}

/** Curved SVG wave divider — used between hero-dark and paper-light. */
function waveDivider(color: string, height = 40, flip = false): string {
  const transform = flip ? ' transform="scale(1,-1) translate(0,-40)"' : "";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 40" preserveAspectRatio="none" width="100%" height="${height}" style="display:block;">
    <path d="M0 0 C 160 40, 320 40, 480 20 C 560 10, 620 20, 640 24 L 640 40 L 0 40 Z" fill="${color}"${transform} />
  </svg>`;
  return svg;
}

/* -------------------------------------------------------------------- */
/*  Section renderers                                                   */
/* -------------------------------------------------------------------- */

function renderIntro(s: EmailSection, ctx: PersonalizationContext, p: ProductPalette): string {
  const greeting = personalize(s.data.greeting || "{{greeting}},", ctx) || "Hello,";
  const body = personalize(s.data.body || "", ctx);
  return band(
    `<div style="max-width:${CONTAINER_INNER}px;">
      ${eyebrow("MDF Exports & Imports", p.primary)}
      ${vspace(14)}
      <p style="margin:0 0 12px 0;font-family:${FONT_STACK};font-size:16px;line-height:1.6;color:${p.text};font-weight:500;">${esc(greeting)}</p>
      ${body ? bodyText(nl2br(body), p.textMuted, { size: 16, maxWidth: CONTAINER_INNER }) : ""}
    </div>`,
    p.paper,
    40,
    56,
  );
}

function renderHero(
  s: EmailSection,
  ctx: PersonalizationContext,
  assets: Record<string, AssetRecord | undefined>,
  p: ProductPalette,
): string {
  const eb = personalize(s.data.eyebrow || "", ctx);
  const headline = personalize(s.data.headline || "", ctx);
  const body = personalize(s.data.body || "", ctx);
  const ctaLabel = personalize(s.data.ctaLabel || "", ctx);
  const ctaUrl = s.data.ctaUrl || "#";
  const hero = assets["hero"];
  const src = assetSrc(hero);

  const imageBlock = src
    ? heroImage(src, headline || "Product hero", { radius: 20, height: 300 })
    : imagePlaceholder("Hero image", {
        bg: hexAlpha(p.paper, 0.14),
        tint: p.invertedMuted,
        radius: 20,
        height: 260,
      });

  const heroInner = `
    ${eb ? eyebrow(eb, p.accent) : ""}
    ${vspace(18)}
    ${displayHeadline(nl2br(headline), p.invertedText, 38)}
    ${body ? `${vspace(18)}${bodyText(nl2br(body), p.invertedMuted, { size: 15.5, maxWidth: 420 })}` : ""}
    ${ctaLabel ? `${vspace(26)}<div style="text-align:left;">${ctaButton(ctaLabel, ctaUrl, { bg: p.ctaBg, fg: p.ctaText, radius: 14 })}</div>` : ""}
    ${vspace(28)}
    ${imageBlock}
  `;

  const heroSurface = surface(heroInner, {
    bg: p.ink,
    radius: 28,
    padY: 40,
    padX: 40,
    fg: p.invertedText,
  });

  // Full-bleed within the email card so no paper stripes frame the hero.
  return band(heroSurface, p.paper, 32, 0);
}

/**
 * Elegant 40+ years trust module.
 * A rounded ivory surface sitting on the paper background. The huge
 * numeral is real HTML text — remains meaningful without images.
 */
function renderHeritage(s: EmailSection, ctx: PersonalizationContext, p: ProductPalette): string {
  const big = personalize(s.data.big || "40+", ctx);
  const title = personalize(s.data.title || "Years of Agricultural Excellence", ctx);
  const body = personalize(s.data.body || "", ctx);

  const inner = `
    <div style="text-align:center;">
      <div style="font-family:${SERIF_STACK};font-size:96px;font-weight:500;line-height:0.95;letter-spacing:-0.045em;color:${p.primary};">${esc(big)}</div>
      ${vspace(10)}
      <div style="font-family:${FONT_STACK};font-size:12px;font-weight:600;letter-spacing:0.22em;text-transform:uppercase;color:${p.primary};">${esc(title)}</div>
      ${body ? `${vspace(14)}<p style="margin:0 auto;font-family:${FONT_STACK};font-size:14.5px;line-height:1.7;color:${p.textMuted};max-width:420px;">${nl2br(body)}</p>` : ""}
      ${vspace(6)}
      <div style="font-family:${FONT_STACK};font-size:11px;letter-spacing:0.16em;text-transform:uppercase;color:${p.textMuted};opacity:0.7;">Since 1984 · MD Fruits Family</div>
    </div>
  `;

  return band(
    surface(inner, {
      bg: p.paper,
      radius: 28,
      padY: 44,
      padX: 32,
    }),
    p.soft,
    24,
    32,
  );
}

function renderOrigin(
  s: EmailSection,
  ctx: PersonalizationContext,
  assets: Record<string, AssetRecord | undefined>,
  p: ProductPalette,
): string {
  const headline = personalize(s.data.headline || "", ctx);
  const body = personalize(s.data.body || "", ctx);
  const originAsset = assets["origin"] || assets["hero"];
  const src = assetSrc(originAsset);
  const image = src
    ? heroImage(src, "Origin", { radius: 20, height: 260 })
    : imagePlaceholder("Origin photography", {
        bg: p.soft,
        tint: p.textMuted,
        radius: 20,
        height: 220,
      });

  const inner = `
    ${eyebrow("Origin", p.primary)}
    ${vspace(14)}
    ${sansHeadline(nl2br(headline), p.text, 24)}
    ${body ? `${vspace(14)}${bodyText(nl2br(body), p.textMuted, { size: 15, maxWidth: 460 })}` : ""}
    ${vspace(24)}
    ${image}
  `;

  return band(
    surface(inner, {
      bg: p.paper,
      radius: 24,
      padY: 32,
      padX: 32,
    }),
    p.paper,
    16,
    32,
  );
}

/**
 * Product options — 3 rounded modules. On mobile they stack.
 */
function renderFormats(
  s: EmailSection,
  ctx: PersonalizationContext,
  assets: Record<string, AssetRecord | undefined>,
  p: ProductPalette,
): string {
  const headline = personalize(s.data.headline || "", ctx);
  const items = [
    { title: s.data.format1Title || "", body: s.data.format1Body || "", asset: assets["stem"] || assets["hero"] },
    { title: s.data.format2Title || "", body: s.data.format2Body || "", asset: assets["stemless"] || assets["hero"] },
    { title: s.data.format3Title || "", body: s.data.format3Body || "", asset: assets["powder"] || assets["hero"] },
  ].filter((it) => it.title || it.body);

  const cell = (item: { title: string; body: string; asset: AssetRecord | undefined }) => {
    const src = assetSrc(item.asset);
    const image = src
      ? `<img src="${esc(src)}" width="180" alt="${esc(item.title)}" style="display:block;width:100%;max-width:180px;height:150px;object-fit:cover;border:0;border-radius:16px;" />`
      : `<div style="background-color:${p.soft};border-radius:16px;height:150px;text-align:center;">
          <div style="font-family:${FONT_STACK};font-size:10.5px;font-weight:600;letter-spacing:0.22em;text-transform:uppercase;color:${p.textMuted};padding-top:66px;">${esc(item.title || "Product")}</div>
        </div>`;
    return `<td valign="top" width="33%" style="padding:0 6px;" class="mdf-stack-cell">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${p.paper};border-radius:20px;overflow:hidden;">
        <tr><td style="padding:14px;">
          ${image}
          <div style="margin-top:14px;font-family:${FONT_STACK};font-size:10.5px;font-weight:600;letter-spacing:0.18em;color:${p.primary};text-transform:uppercase;">${esc(item.title)}</div>
          <div style="margin-top:6px;font-family:${FONT_STACK};font-size:13.5px;line-height:1.55;color:${p.textMuted};">${esc(item.body)}</div>
        </td></tr>
      </table>
    </td>`;
  };

  const inner = `
    ${eyebrow("Available formats", p.primary)}
    ${vspace(12)}
    ${sansHeadline(nl2br(headline), p.text, 24)}
    ${vspace(24)}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="mdf-stack" style="border-collapse:separate;border-spacing:0;">
      <tr>${items.map(cell).join("")}</tr>
    </table>
  `;

  return band(
    surface(inner, {
      bg: p.soft,
      radius: 24,
      padY: 32,
      padX: 28,
    }),
    p.paper,
    16,
    32,
  );
}

function renderPacking(
  s: EmailSection,
  ctx: PersonalizationContext,
  assets: Record<string, AssetRecord | undefined>,
  p: ProductPalette,
): string {
  const headline = personalize(s.data.headline || "Packed for your market.", ctx);
  const body = personalize(s.data.body || "", ctx);
  const items = [s.data.item1, s.data.item2, s.data.item3].filter(Boolean) as string[];
  const ctaLabel = personalize(s.data.ctaLabel || "", ctx);
  const ctaUrl = s.data.ctaUrl || "#";
  const packing = assets["packing"];
  const src = assetSrc(packing);

  const imageBlock = src
    ? `<img src="${esc(src)}" width="${CONTAINER_INNER}" alt="Packing" style="display:block;width:100%;max-width:${CONTAINER_INNER}px;height:220px;object-fit:cover;border:0;border-radius:16px;" />`
    : imagePlaceholder("Packing photography", {
        bg: hexAlpha(p.paper, 0.1),
        tint: p.invertedMuted,
        radius: 16,
        height: 200,
      });

  const inner = `
    ${eyebrow("Packing", p.accent)}
    ${vspace(14)}
    ${displayHeadline(nl2br(headline), p.invertedText, 28)}
    ${body ? `${vspace(14)}${bodyText(nl2br(body), p.invertedMuted, { size: 15, maxWidth: 460 })}` : ""}
    ${items.length ? `${vspace(22)}<div>${items
      .map(
        (i) =>
          `<div style="display:inline-block;background-color:${hexAlpha(p.paper, 0.09)};border:1px solid ${hexAlpha(p.paper, 0.18)};color:${p.invertedText};font-family:${FONT_STACK};font-size:12.5px;padding:8px 14px;border-radius:999px;margin:0 6px 6px 0;">${esc(i)}</div>`,
      )
      .join("")}</div>` : ""}
    ${vspace(24)}
    ${imageBlock}
    ${ctaLabel ? `${vspace(26)}${ctaButton(ctaLabel, ctaUrl, { bg: p.ctaBg, fg: p.ctaText, radius: 14 })}` : ""}
  `;

  return band(
    surface(inner, {
      bg: p.primaryDeep,
      radius: 28,
      padY: 40,
      padX: 36,
      fg: p.invertedText,
    }),
    p.paper,
    24,
    0,
  );
}

/**
 * Three trust statements — no icons, no equal-height cards.
 * Editorial rows separated by soft rules.
 */
function renderWhy(s: EmailSection, ctx: PersonalizationContext, p: ProductPalette): string {
  const headline = personalize(s.data.headline || "Why MDF.", ctx);
  const points = [
    { t: s.data.p1Title, b: s.data.p1Body },
    { t: s.data.p2Title, b: s.data.p2Body },
    { t: s.data.p3Title, b: s.data.p3Body },
    { t: s.data.p4Title, b: s.data.p4Body },
  ]
    .filter((pt) => pt.t || pt.b)
    .slice(0, 3);

  const inner = `
    ${eyebrow("Why MDF", p.primary)}
    ${vspace(14)}
    ${sansHeadline(nl2br(headline), p.text, 24)}
    ${vspace(20)}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      ${points
        .map(
          (pt, i) =>
            `<tr>
              <td style="padding:${i === 0 ? "18px 0 18px 0" : "18px 0"};${i === 0 ? "" : `border-top:1px solid ${p.border};`}">
                <div style="font-family:${FONT_STACK};font-size:15.5px;font-weight:600;color:${p.text};letter-spacing:-0.005em;">${esc(pt.t || "")}</div>
                <div style="margin-top:6px;font-family:${FONT_STACK};font-size:14.5px;line-height:1.6;color:${p.textMuted};">${esc(pt.b || "")}</div>
              </td>
            </tr>`,
        )
        .join("")}
    </table>
  `;

  return band(
    surface(inner, {
      bg: p.paper,
      radius: 24,
      padY: 32,
      padX: 32,
    }),
    p.paper,
    16,
    32,
  );
}

function renderCta(s: EmailSection, ctx: PersonalizationContext, p: ProductPalette): string {
  const headline = personalize(s.data.headline || "", ctx);
  const body = personalize(s.data.body || "", ctx);
  const ctaLabel = personalize(s.data.ctaLabel || "", ctx);
  const ctaUrl = s.data.ctaUrl || "#";
  const secondaryLabel = personalize(s.data.secondaryLabel || "", ctx);
  const secondaryUrl = s.data.secondaryUrl || "";
  const footnote = personalize(s.data.footnote || "", ctx);

  const inner = `
    <div style="text-align:center;">
      ${eyebrow("Next step", p.accent)}
      ${vspace(14)}
      ${displayHeadline(nl2br(headline), p.invertedText, 30)}
      ${body ? `${vspace(14)}<p style="margin:0 auto;font-family:${FONT_STACK};font-size:15.5px;line-height:1.7;color:${p.invertedMuted};max-width:440px;">${nl2br(body)}</p>` : ""}
      ${ctaLabel ? `${vspace(26)}${ctaButton(ctaLabel, ctaUrl, { bg: p.ctaBg, fg: p.ctaText, radius: 14 })}` : ""}
      ${
        secondaryLabel
          ? `${vspace(14)}<div><a href="${esc(secondaryUrl)}" style="font-family:${FONT_STACK};font-size:12.5px;letter-spacing:0.14em;color:${p.invertedMuted};text-decoration:none;text-transform:uppercase;">${esc(secondaryLabel)}</a></div>`
          : ""
      }
      ${
        footnote
          ? `${vspace(24)}<p style="margin:0;font-family:${FONT_STACK};font-size:12px;color:${p.invertedMuted};letter-spacing:0.03em;">${esc(footnote)}</p>`
          : ""
      }
    </div>
  `;

  return band(
    surface(inner, {
      bg: p.ink,
      radius: 28,
      padY: 44,
      padX: 36,
      fg: p.invertedText,
    }),
    p.paper,
    24,
    0,
  );
}

function renderFooter(settings: WorkspaceSettings, p: ProductPalette): string {
  const c = settings.company;
  const e = settings.email;
  const socials: Array<[string, string]> = [];
  if (e.instagramUrl) socials.push(["Instagram", e.instagramUrl]);
  if (e.linkedinUrl) socials.push(["LinkedIn", e.linkedinUrl]);
  if (e.whatsappUrl) socials.push(["WhatsApp", e.whatsappUrl]);

  const inner = `
    <div style="text-align:center;font-family:${FONT_STACK};color:${p.textMuted};">
      <div style="font-family:${FONT_STACK};font-size:14px;font-weight:600;letter-spacing:-0.005em;color:${p.text};">${esc(c.companyName)}</div>
      ${c.tagline ? `<div style="margin-top:6px;font-family:${SERIF_STACK};font-size:14px;color:${p.textMuted};font-style:italic;">${esc(c.tagline)}</div>` : ""}
      <div style="margin-top:14px;font-size:11px;letter-spacing:0.16em;color:${p.textMuted};text-transform:uppercase;opacity:0.7;">Since 1984 · MD Fruits Family Business</div>
      ${(c.website || c.email) ? `<div style="margin-top:16px;font-size:12.5px;">
        ${c.website ? `<a href="${esc(c.website)}" style="color:${p.textMuted};text-decoration:none;">${esc(c.website.replace(/^https?:\/\//, ""))}</a>` : ""}
        ${c.website && c.email ? "&nbsp;·&nbsp;" : ""}
        ${c.email ? `<a href="mailto:${esc(c.email)}" style="color:${p.textMuted};text-decoration:none;">${esc(c.email)}</a>` : ""}
      </div>` : ""}
      ${socials.length ? `<div style="margin-top:12px;font-size:11px;letter-spacing:0.16em;text-transform:uppercase;">${socials
        .map(([label, url]) => `<a href="${esc(url)}" style="color:${p.textMuted};text-decoration:none;margin:0 8px;">${esc(label)}</a>`)
        .join(" · ")}</div>` : ""}
      <div style="margin-top:20px;font-size:11px;color:${p.textMuted};opacity:0.55;line-height:1.6;">You received this email because you were identified as a potential trade partner.<br />Reply to unsubscribe.</div>
    </div>
  `;

  return band(inner, p.paper, 40, 40);
}

/* -------------------------------------------------------------------- */
/*  Direct variant — compact procurement composition                    */
/* -------------------------------------------------------------------- */

/**
 * When the template is variant="direct", we replace the standard section
 * chain with a compact 3-part composition:
 *   1. intro + compact chips + CTA (single hero-like surface)
 *   2. trust line
 *   3. footer
 * This keeps the section model but changes the visual rhythm entirely.
 */
function renderDirect(
  template: EmailTemplate,
  ctx: PersonalizationContext,
  assets: Record<string, AssetRecord | undefined>,
  settings: WorkspaceSettings,
  p: ProductPalette,
): string {
  const intro = template.sections.find((s) => s.type === "intro");
  const hero = template.sections.find((s) => s.type === "hero");
  const cta = template.sections.find((s) => s.type === "cta");

  const greeting = personalize(intro?.data.greeting || "{{greeting}},", ctx) || "Hello,";
  const introBody = personalize(intro?.data.body || "", ctx);
  const eb = personalize(hero?.data.eyebrow || "", ctx);
  const headline = personalize(hero?.data.headline || "", ctx);
  const chipsRaw = personalize(hero?.data.body || "", ctx);
  const chips = chipsRaw
    .split(/\n|·/)
    .map((s) => s.replace(/^[-•\s]+/, "").trim())
    .filter(Boolean)
    .slice(0, 4);

  const ctaLabel = personalize(cta?.data.ctaLabel || hero?.data.ctaLabel || "Request price & specs", ctx);
  const ctaUrl = cta?.data.ctaUrl || hero?.data.ctaUrl || "#";
  const heroAsset = assets["hero"];
  const heroSrc = assetSrc(heroAsset);

  const compactImage = heroSrc
    ? `<img src="${esc(heroSrc)}" width="${CONTAINER_INNER}" alt="${esc(headline)}" style="display:block;width:100%;max-width:${CONTAINER_INNER}px;height:200px;object-fit:cover;border:0;border-radius:18px;" />`
    : imagePlaceholder("Product photography", {
        bg: hexAlpha(p.paper, 0.14),
        tint: p.invertedMuted,
        radius: 18,
        height: 180,
      });

  // Personal opening on paper
  const opening = band(
    `<div style="max-width:${CONTAINER_INNER}px;">
      ${eyebrow("MDF Exports & Imports", p.primary)}
      ${vspace(14)}
      <p style="margin:0 0 12px 0;font-family:${FONT_STACK};font-size:16px;line-height:1.6;color:${p.text};font-weight:500;">${esc(greeting)}</p>
      ${introBody ? bodyText(nl2br(introBody), p.textMuted, { size: 16, maxWidth: CONTAINER_INNER }) : ""}
    </div>`,
    p.paper,
    36,
    56,
  );

  // Compact rounded procurement hero
  const heroCompactInner = `
    ${eb ? eyebrow(eb, p.accent) : ""}
    ${vspace(14)}
    ${displayHeadline(nl2br(headline), p.invertedText, 30)}
    ${chips.length ? `${vspace(20)}<div>${chips
      .map(
        (c) =>
          `<div style="display:inline-block;background-color:${hexAlpha(p.paper, 0.09)};border:1px solid ${hexAlpha(p.paper, 0.18)};color:${p.invertedText};font-family:${FONT_STACK};font-size:13px;padding:8px 14px;border-radius:999px;margin:0 6px 6px 0;">${esc(c)}</div>`,
      )
      .join("")}</div>` : ""}
    ${vspace(24)}
    ${compactImage}
    ${vspace(22)}
    <div style="text-align:left;">${ctaButton(ctaLabel, ctaUrl, { bg: p.ctaBg, fg: p.ctaText, radius: 14 })}</div>
  `;

  const heroBand = band(
    surface(heroCompactInner, {
      bg: p.ink,
      radius: 28,
      padY: 36,
      padX: 36,
      fg: p.invertedText,
    }),
    p.paper,
    16,
    0,
  );

  // Trust line
  const trustBand = band(
    surface(
      `<div style="text-align:center;">
        <div style="font-family:${SERIF_STACK};font-size:44px;font-weight:500;line-height:1;letter-spacing:-0.03em;color:${p.primary};">40+</div>
        <div style="margin-top:8px;font-family:${FONT_STACK};font-size:11.5px;letter-spacing:0.22em;text-transform:uppercase;color:${p.primary};font-weight:600;">Years of Agricultural Excellence</div>
        <div style="margin-top:4px;font-family:${FONT_STACK};font-size:11px;color:${p.textMuted};opacity:0.7;letter-spacing:0.14em;text-transform:uppercase;">Since 1984 · MD Fruits Family</div>
      </div>`,
      {
        bg: p.soft,
        radius: 20,
        padY: 26,
        padX: 24,
      },
    ),
    p.paper,
    8,
    32,
  );

  const footerBand = renderFooter(settings, p);

  return `${opening}${heroBand}${trustBand}${footerBand}`;
}

/* -------------------------------------------------------------------- */
/*  Section dispatch (Signature variant / default)                      */
/* -------------------------------------------------------------------- */

function renderSection(
  s: EmailSection,
  ctx: PersonalizationContext,
  settings: WorkspaceSettings,
  assets: Record<string, AssetRecord | undefined>,
  p: ProductPalette,
): string {
  switch (s.type) {
    case "intro":
      return renderIntro(s, ctx, p);
    case "hero":
      return renderHero(s, ctx, assets, p);
    case "heritage":
      return renderHeritage(s, ctx, p);
    case "origin":
      return renderOrigin(s, ctx, assets, p);
    case "formats":
      return renderFormats(s, ctx, assets, p);
    case "packing":
      return renderPacking(s, ctx, assets, p);
    case "why":
      return renderWhy(s, ctx, p);
    case "cta":
      return renderCta(s, ctx, p);
    case "footer":
      return renderFooter(settings, p);
    default:
      return "";
  }
}

/* -------------------------------------------------------------------- */
/*  Entrypoints                                                         */
/* -------------------------------------------------------------------- */

export function renderEmailHtml(opts: RenderOptions): string {
  const { template, buyer, settings, assetsBySlot } = opts;
  currentRenderMode = opts.mode ?? "preview";
  const palette = resolvePalette(template);
  const ctx = buildContext(buyer, opts.productName);
  const preheader = personalize(settings.email.defaultPreheader || "", ctx);

  // NOTE: the dark-mode media block is intentionally NARROW. Applying
  // `background-color !important` to a broad selector like `table` cascades
  // to every nested table including the CTA button — which is exactly
  // what caused the "white blocks around the CTA" bug. Only the body and
  // the explicitly-classed shell table are re-declared.
  const styleBlock = `
    <style>
      @media only screen and (max-width: 600px) {
        .mdf-container { width: 100% !important; border-radius: 0 !important; }
        .mdf-pad { padding-left: 20px !important; padding-right: 20px !important; }
        .mdf-stack, .mdf-stack tr, .mdf-stack td { display: block !important; width: 100% !important; }
        .mdf-stack-cell { padding: 0 0 12px 0 !important; }
        h1 { font-size: 30px !important; }
        h2 { font-size: 22px !important; }
      }
      @media (prefers-color-scheme: dark) {
        body { background-color: ${palette.canvas} !important; }
        .mdf-outer-shell { background-color: ${palette.canvas} !important; }
      }
    </style>
  `;

  const preheaderHtml = preheader
    ? `<div style="display:none;overflow:hidden;line-height:1px;opacity:0;max-height:0;max-width:0;visibility:hidden;font-size:1px;color:${palette.paper};">${esc(preheader)}</div>`
    : "";

  let body: string;
  if (template.variant === "direct") {
    body = renderDirect(template, ctx, assetsBySlot, settings, palette);
  } else {
    const visible = template.sections.filter((s) => s.visible);
    body = visible
      .map((s) => renderSection(s, ctx, settings, assetsBySlot, palette))
      .join("\n");
  }

  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="format-detection" content="telephone=no" />
  <meta name="color-scheme" content="light" />
  <meta name="supported-color-schemes" content="light" />
  <title>${esc(settings.company.companyName)}</title>
  ${styleBlock}
</head>
<body style="margin:0;padding:0;background-color:${palette.canvas};-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">
  ${preheaderHtml}
  ${shellOpen(palette)}
    ${body}
  ${shellClose()}
</body>
</html>`;
}

export function renderEmailText(opts: RenderOptions): string {
  const { template, buyer, settings } = opts;
  const ctx = buildContext(buyer, opts.productName);
  const c = settings.company;
  const lines: string[] = [];
  const greetSection = template.sections.find((s) => s.type === "intro" && s.visible);
  if (greetSection) {
    lines.push(personalize(greetSection.data.greeting || "{{greeting}},", ctx) || "Hello,");
    lines.push("");
    if (greetSection.data.body) lines.push(personalize(greetSection.data.body, ctx));
    lines.push("");
  }
  const heroSection = template.sections.find((s) => s.type === "hero" && s.visible);
  if (heroSection) {
    if (heroSection.data.headline)
      lines.push(personalize(heroSection.data.headline, ctx).replace(/\n/g, " "));
    if (heroSection.data.body) lines.push(personalize(heroSection.data.body, ctx));
    lines.push("");
  }
  const formats = template.sections.find((s) => s.type === "formats" && s.visible);
  if (formats) {
    lines.push("Available formats:");
    if (formats.data.format1Title)
      lines.push(`  - ${formats.data.format1Title}: ${formats.data.format1Body ?? ""}`.trim());
    if (formats.data.format2Title)
      lines.push(`  - ${formats.data.format2Title}: ${formats.data.format2Body ?? ""}`.trim());
    if (formats.data.format3Title)
      lines.push(`  - ${formats.data.format3Title}: ${formats.data.format3Body ?? ""}`.trim());
    lines.push("");
  }
  const packing = template.sections.find((s) => s.type === "packing" && s.visible);
  if (packing?.data.body) {
    lines.push(personalize(packing.data.body, ctx));
    lines.push("");
  }
  const heritage = template.sections.find((s) => s.type === "heritage" && s.visible);
  if (heritage) {
    const big = personalize(heritage.data.big || "40+", ctx);
    const title = personalize(heritage.data.title || "Years of Agricultural Excellence", ctx);
    lines.push(`${big} ${title}`);
    if (heritage.data.body) lines.push(personalize(heritage.data.body, ctx));
    lines.push("");
  }
  const cta = template.sections.find((s) => s.type === "cta" && s.visible);
  if (cta) {
    if (cta.data.body) lines.push(personalize(cta.data.body, ctx));
    if (cta.data.ctaLabel) {
      lines.push("");
      lines.push(`${cta.data.ctaLabel}: ${cta.data.ctaUrl || ""}`);
    }
    if (cta.data.secondaryLabel) {
      lines.push(`${cta.data.secondaryLabel}: ${cta.data.secondaryUrl || ""}`);
    }
    lines.push("");
  }
  lines.push("---");
  lines.push(c.companyName);
  if (c.tagline) lines.push(c.tagline);
  if (c.heritage) lines.push(c.heritage);
  if (c.location) lines.push(c.location);
  if (c.website) lines.push(c.website);
  if (c.email) lines.push(c.email);
  return lines.filter((l) => l !== undefined).join("\n");
}

/* -------------------------------------------------------------------- */

function hexAlpha(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  const n = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  if (!/^[0-9a-fA-F]{6}$/.test(n)) return hex;
  const r = parseInt(n.slice(0, 2), 16);
  const g = parseInt(n.slice(2, 4), 16);
  const b = parseInt(n.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

// waveDivider is exported for future use in per-product custom compositions.
export { waveDivider };
