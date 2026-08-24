import type {
  AssetRecord,
  Buyer,
  EmailSection,
  EmailTemplate,
  WorkspaceSettings,
} from "@/lib/types";
import { buildContext, personalize, type PersonalizationContext } from "./personalize";

export interface RenderOptions {
  template: EmailTemplate;
  buyer: Buyer | null;
  settings: WorkspaceSettings;
  assetsBySlot: Record<string, AssetRecord | undefined>;
  productName?: string;
}

const IVORY = "#FAF8F4";
const CANVAS = "#F2EFE9";
const CHARCOAL = "#151515";
const ORANGE = "#F36B21";
const CHILLI = "#A62921";
const BORDER = "#E6E1D9";
const MUTED = "#737373";
const SUBTLE_INK = "#3B3B3B";
const TEXT = "#1F1F1F";

const FONT_STACK =
  "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";

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

function assetSrc(a: AssetRecord | undefined): string {
  if (!a) return "";
  return a.productionUrl?.trim() || a.localDataUrl || "";
}

function containerOpen(bg = IVORY): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${bg};margin:0;padding:0;">
  <tr><td align="center" style="padding:0;">
    <table role="presentation" width="640" cellpadding="0" cellspacing="0" border="0" style="width:640px;max-width:640px;background-color:${bg};" class="mdf-container">`;
}
function containerClose(): string {
  return `</table>
  </td></tr>
</table>`;
}

function section(content: string, bg: string, opts: { padY?: number; padX?: number } = {}): string {
  const padY = opts.padY ?? 48;
  const padX = opts.padX ?? 40;
  return `<tr><td style="background-color:${bg};padding:${padY}px ${padX}px;" class="mdf-pad">${content}</td></tr>`;
}

function ctaButton(label: string, url: string, style: "primary" | "ghost" | "dark" = "primary"): string {
  const bg = style === "primary" ? ORANGE : style === "dark" ? "#FFFFFF" : "transparent";
  const color = style === "primary" ? "#FFFFFF" : style === "dark" ? CHARCOAL : "#FFFFFF";
  const border = style === "ghost" ? "1px solid rgba(255,255,255,0.5)" : "0";
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto;"><tr>
    <td align="center" bgcolor="${bg}" style="border-radius:2px;border:${border};">
      <a href="${esc(url)}" target="_blank" rel="noopener" style="display:inline-block;padding:16px 30px;font-family:${FONT_STACK};font-size:12px;font-weight:600;letter-spacing:0.14em;color:${color};text-decoration:none;text-transform:uppercase;">${esc(label)}</a>
    </td>
  </tr></table>`;
}

function renderIntro(s: EmailSection, ctx: PersonalizationContext): string {
  const greeting = personalize(s.data.greeting || "{{greeting}},", ctx) || "Hello,";
  const body = personalize(s.data.body || "", ctx);
  return section(
    `<div style="font-family:${FONT_STACK};color:${TEXT};font-size:16px;line-height:1.6;">
      <p style="margin:0 0 14px 0;font-size:16px;color:${TEXT};">${esc(greeting)}</p>
      <p style="margin:0;font-size:16px;color:${SUBTLE_INK};line-height:1.65;">${nl2br(body)}</p>
    </div>`,
    IVORY,
    { padY: 44 },
  );
}

function renderHero(
  s: EmailSection,
  ctx: PersonalizationContext,
  assets: Record<string, AssetRecord | undefined>,
): string {
  const eyebrow = personalize(s.data.eyebrow || "", ctx);
  const headline = personalize(s.data.headline || "", ctx);
  const body = personalize(s.data.body || "", ctx);
  const ctaLabel = personalize(s.data.ctaLabel || "", ctx);
  const ctaUrl = s.data.ctaUrl || "#";
  const hero = assets["hero"];
  const heroSrc = assetSrc(hero);
  const imageBlock = heroSrc
    ? `<img src="${esc(heroSrc)}" width="560" alt="Guntur dry red chilli" style="display:block;width:100%;max-width:560px;height:auto;border:0;outline:none;border-radius:2px;" />`
    : `<div style="height:280px;background-color:${CANVAS};border:1px solid ${BORDER};border-radius:2px;font-family:${FONT_STACK};color:${MUTED};font-size:12px;letter-spacing:0.12em;text-align:center;line-height:280px;">HERO IMAGE</div>`;

  return section(
    `<div style="font-family:${FONT_STACK};">
      <div style="font-size:11px;letter-spacing:0.18em;color:${CHILLI};margin-bottom:20px;">${esc(eyebrow)}</div>
      <h1 style="margin:0 0 20px 0;font-family:${FONT_STACK};font-weight:600;font-size:42px;line-height:1.08;letter-spacing:-0.02em;color:${CHARCOAL};">${nl2br(headline)}</h1>
      <p style="margin:0 0 32px 0;font-size:16px;line-height:1.6;color:${SUBTLE_INK};max-width:520px;">${nl2br(body)}</p>
      ${ctaLabel ? ctaButton(ctaLabel, ctaUrl, "primary") : ""}
      <div style="height:36px;line-height:36px;">&nbsp;</div>
      ${imageBlock}
    </div>`,
    IVORY,
    { padY: 40 },
  );
}

function renderHeritage(s: EmailSection, ctx: PersonalizationContext): string {
  const big = personalize(s.data.big || "40+", ctx);
  const title = personalize(s.data.title || "", ctx);
  const body = personalize(s.data.body || "", ctx);
  return section(
    `<div style="font-family:${FONT_STACK};text-align:center;">
      <div style="font-family:${FONT_STACK};font-size:96px;font-weight:600;line-height:1;letter-spacing:-0.04em;color:#FFFFFF;margin-bottom:8px;">${esc(big)}</div>
      <div style="font-size:13px;letter-spacing:0.18em;color:${ORANGE};text-transform:uppercase;margin-bottom:20px;">${esc(title)}</div>
      <p style="margin:0 auto;max-width:440px;font-size:15px;line-height:1.65;color:rgba(255,255,255,0.72);">${nl2br(body)}</p>
    </div>`,
    CHARCOAL,
    { padY: 72 },
  );
}

function renderOrigin(
  s: EmailSection,
  ctx: PersonalizationContext,
  assets: Record<string, AssetRecord | undefined>,
): string {
  const headline = personalize(s.data.headline || "", ctx);
  const body = personalize(s.data.body || "", ctx);
  const originAsset = assets["origin"] || assets["hero"];
  const src = assetSrc(originAsset);
  const image = src
    ? `<img src="${esc(src)}" width="560" alt="Guntur origin" style="display:block;width:100%;max-width:560px;height:auto;border:0;border-radius:2px;" />`
    : `<div style="height:220px;background-color:${CANVAS};border:1px solid ${BORDER};border-radius:2px;font-family:${FONT_STACK};color:${MUTED};font-size:12px;letter-spacing:0.12em;text-align:center;line-height:220px;">ORIGIN IMAGE</div>`;
  return section(
    `<div style="font-family:${FONT_STACK};">
      <h2 style="margin:0 0 16px 0;font-weight:600;font-size:32px;line-height:1.12;letter-spacing:-0.02em;color:${CHARCOAL};">${nl2br(headline)}</h2>
      <p style="margin:0 0 28px 0;font-size:15px;line-height:1.65;color:${SUBTLE_INK};max-width:520px;">${nl2br(body)}</p>
      ${image}
    </div>`,
    IVORY,
    { padY: 56 },
  );
}

function renderFormats(
  s: EmailSection,
  ctx: PersonalizationContext,
  assets: Record<string, AssetRecord | undefined>,
): string {
  const headline = personalize(s.data.headline || "", ctx);
  const items = [
    { title: s.data.format1Title || "WITH STEM", body: s.data.format1Body || "", asset: assets["stem"] },
    { title: s.data.format2Title || "STEMLESS", body: s.data.format2Body || "", asset: assets["stemless"] },
    { title: s.data.format3Title || "CHILLI POWDER", body: s.data.format3Body || "", asset: assets["powder"] },
  ];
  const cell = (item: (typeof items)[number]) => {
    const src = assetSrc(item.asset);
    const img = src
      ? `<img src="${esc(src)}" width="170" alt="${esc(item.title)}" style="display:block;width:100%;max-width:170px;height:170px;object-fit:cover;border:0;border-radius:2px;" />`
      : `<div style="width:100%;height:170px;background-color:${CANVAS};border:1px solid ${BORDER};border-radius:2px;font-family:${FONT_STACK};color:${MUTED};font-size:11px;letter-spacing:0.12em;text-align:center;line-height:170px;">${esc(item.title)}</div>`;
    return `<td valign="top" width="33%" style="padding:0 8px;">
      ${img}
      <div style="margin-top:16px;font-family:${FONT_STACK};font-size:11px;font-weight:600;letter-spacing:0.14em;color:${CHILLI};">${esc(item.title)}</div>
      <div style="margin-top:8px;font-family:${FONT_STACK};font-size:14px;line-height:1.55;color:${SUBTLE_INK};">${esc(item.body)}</div>
    </td>`;
  };
  return section(
    `<div style="font-family:${FONT_STACK};">
      <h2 style="margin:0 0 32px 0;font-weight:600;font-size:32px;line-height:1.12;letter-spacing:-0.02em;color:${CHARCOAL};">${nl2br(headline)}</h2>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="mdf-stack">
        <tr>${items.map(cell).join("")}</tr>
      </table>
    </div>`,
    IVORY,
    { padY: 56 },
  );
}

function renderPacking(
  s: EmailSection,
  ctx: PersonalizationContext,
  assets: Record<string, AssetRecord | undefined>,
): string {
  const headline = personalize(s.data.headline || "", ctx);
  const body = personalize(s.data.body || "", ctx);
  const items = [s.data.item1, s.data.item2, s.data.item3].filter(Boolean);
  const ctaLabel = personalize(s.data.ctaLabel || "", ctx);
  const ctaUrl = s.data.ctaUrl || "#";
  const packing = assets["packing"];
  const src = assetSrc(packing);
  const image = src
    ? `<img src="${esc(src)}" width="560" alt="Export packing" style="display:block;width:100%;max-width:560px;height:auto;border:0;border-radius:2px;" />`
    : `<div style="height:220px;background-color:#FFFFFF;border:1px solid ${BORDER};border-radius:2px;font-family:${FONT_STACK};color:${MUTED};font-size:12px;letter-spacing:0.12em;text-align:center;line-height:220px;">PACKING IMAGE</div>`;
  return section(
    `<div style="font-family:${FONT_STACK};">
      <h2 style="margin:0 0 16px 0;font-weight:600;font-size:32px;line-height:1.12;letter-spacing:-0.02em;color:${CHARCOAL};">${nl2br(headline)}</h2>
      <p style="margin:0 0 24px 0;font-size:15px;line-height:1.65;color:${SUBTLE_INK};max-width:520px;">${nl2br(body)}</p>
      <div style="margin:0 0 28px 0;">
        ${items
          .map(
            (i) =>
              `<div style="font-family:${FONT_STACK};font-size:13px;letter-spacing:0.02em;color:${CHARCOAL};padding:10px 0;border-top:1px solid ${BORDER};">${esc(i!)}</div>`,
          )
          .join("")}
        <div style="border-top:1px solid ${BORDER};"></div>
      </div>
      ${image}
      <div style="height:32px;line-height:32px;">&nbsp;</div>
      ${ctaLabel ? ctaButton(ctaLabel, ctaUrl, "primary") : ""}
    </div>`,
    CANVAS,
    { padY: 56 },
  );
}

function renderWhy(s: EmailSection, ctx: PersonalizationContext): string {
  const headline = personalize(s.data.headline || "", ctx);
  const points: Array<{ t?: string; b?: string }> = [
    { t: s.data.p1Title, b: s.data.p1Body },
    { t: s.data.p2Title, b: s.data.p2Body },
    { t: s.data.p3Title, b: s.data.p3Body },
    { t: s.data.p4Title, b: s.data.p4Body },
    { t: s.data.p5Title, b: s.data.p5Body },
  ].filter((p) => p.t || p.b);
  return section(
    `<div style="font-family:${FONT_STACK};">
      <h2 style="margin:0 0 28px 0;font-weight:600;font-size:32px;line-height:1.12;letter-spacing:-0.02em;color:${CHARCOAL};">${nl2br(headline)}</h2>
      <div>
        ${points
          .map(
            (p) =>
              `<div style="padding:18px 0;border-top:1px solid ${BORDER};">
                <div style="font-family:${FONT_STACK};font-size:11px;font-weight:600;letter-spacing:0.16em;color:${CHILLI};text-transform:uppercase;">${esc(p.t || "")}</div>
                <div style="margin-top:8px;font-family:${FONT_STACK};font-size:15px;line-height:1.6;color:${SUBTLE_INK};">${esc(p.b || "")}</div>
              </div>`,
          )
          .join("")}
        <div style="border-top:1px solid ${BORDER};"></div>
      </div>
    </div>`,
    IVORY,
    { padY: 56 },
  );
}

function renderCta(s: EmailSection, ctx: PersonalizationContext): string {
  const headline = personalize(s.data.headline || "", ctx);
  const body = personalize(s.data.body || "", ctx);
  const ctaLabel = personalize(s.data.ctaLabel || "", ctx);
  const ctaUrl = s.data.ctaUrl || "#";
  const secondaryLabel = personalize(s.data.secondaryLabel || "", ctx);
  const secondaryUrl = s.data.secondaryUrl || "";
  const footnote = personalize(s.data.footnote || "", ctx);
  return section(
    `<div style="font-family:${FONT_STACK};text-align:center;color:#FFFFFF;">
      <h2 style="margin:0 0 20px 0;font-weight:600;font-size:32px;line-height:1.15;letter-spacing:-0.02em;color:#FFFFFF;">${nl2br(headline)}</h2>
      <p style="margin:0 auto 32px auto;font-size:15px;line-height:1.65;color:rgba(255,255,255,0.72);max-width:440px;">${nl2br(body)}</p>
      ${ctaLabel ? ctaButton(ctaLabel, ctaUrl, "primary") : ""}
      ${
        secondaryLabel
          ? `<div style="margin-top:14px;"><a href="${esc(secondaryUrl)}" style="font-family:${FONT_STACK};font-size:12px;letter-spacing:0.14em;color:rgba(255,255,255,0.72);text-decoration:none;text-transform:uppercase;">${esc(secondaryLabel)}</a></div>`
          : ""
      }
      ${
        footnote
          ? `<p style="margin:26px 0 0 0;font-size:12px;color:rgba(255,255,255,0.5);letter-spacing:0.02em;">${esc(footnote)}</p>`
          : ""
      }
    </div>`,
    CHARCOAL,
    { padY: 68 },
  );
}

function renderFooter(settings: WorkspaceSettings): string {
  const c = settings.company;
  const e = settings.email;
  const socials: Array<[string, string]> = [];
  if (e.instagramUrl) socials.push(["Instagram", e.instagramUrl]);
  if (e.linkedinUrl) socials.push(["LinkedIn", e.linkedinUrl]);
  if (e.whatsappUrl) socials.push(["WhatsApp", e.whatsappUrl]);
  return section(
    `<div style="font-family:${FONT_STACK};text-align:center;color:${MUTED};">
      <div style="font-family:${FONT_STACK};font-size:15px;font-weight:600;letter-spacing:-0.01em;color:${CHARCOAL};">${esc(c.companyName)}</div>
      <div style="margin-top:6px;font-size:13px;color:${MUTED};font-style:italic;">${esc(c.tagline)}</div>
      <div style="margin-top:16px;font-size:11px;letter-spacing:0.14em;color:${MUTED};text-transform:uppercase;">${esc(c.heritage)}</div>
      <div style="margin-top:6px;font-size:12px;color:${MUTED};">${esc(c.location)}</div>
      <div style="margin-top:20px;font-size:12px;color:${MUTED};">
        <a href="${esc(c.website)}" style="color:${MUTED};text-decoration:none;">${esc(c.website.replace(/^https?:\/\//, ""))}</a>
        &nbsp;·&nbsp;
        <a href="mailto:${esc(c.email)}" style="color:${MUTED};text-decoration:none;">${esc(c.email)}</a>
      </div>
      ${
        socials.length
          ? `<div style="margin-top:14px;font-size:11px;letter-spacing:0.14em;text-transform:uppercase;">${socials
              .map(([label, url]) => `<a href="${esc(url)}" style="color:${MUTED};text-decoration:none;margin:0 8px;">${esc(label)}</a>`)
              .join("·")}</div>`
          : ""
      }
      <div style="margin-top:22px;font-size:11px;color:#A6A19A;">You received this email because you were identified as a potential trade partner. Reply to unsubscribe.</div>
    </div>`,
    IVORY,
    { padY: 40 },
  );
}

function sectionBg(type: EmailSection["type"]): string {
  switch (type) {
    case "heritage":
    case "cta":
      return CHARCOAL;
    case "packing":
      return CANVAS;
    default:
      return IVORY;
  }
}

function renderSection(
  s: EmailSection,
  ctx: PersonalizationContext,
  settings: WorkspaceSettings,
  assets: Record<string, AssetRecord | undefined>,
): string {
  switch (s.type) {
    case "intro":
      return renderIntro(s, ctx);
    case "hero":
      return renderHero(s, ctx, assets);
    case "heritage":
      return renderHeritage(s, ctx);
    case "origin":
      return renderOrigin(s, ctx, assets);
    case "formats":
      return renderFormats(s, ctx, assets);
    case "packing":
      return renderPacking(s, ctx, assets);
    case "why":
      return renderWhy(s, ctx);
    case "cta":
      return renderCta(s, ctx);
    case "footer":
      return renderFooter(settings);
    default:
      return "";
  }
}

export function renderEmailHtml(opts: RenderOptions): string {
  const { template, buyer, settings, assetsBySlot } = opts;
  const ctx = buildContext(buyer, opts.productName);
  const visible = template.sections.filter((s) => s.visible);

  const preheader = personalize(settings.email.defaultPreheader || "", ctx);

  const styleBlock = `
    <style>
      @media only screen and (max-width: 600px) {
        .mdf-container { width: 100% !important; }
        .mdf-pad { padding-left: 24px !important; padding-right: 24px !important; }
        .mdf-stack td { display: block !important; width: 100% !important; padding: 0 0 24px 0 !important; }
        .mdf-stack td img { max-width: 100% !important; height: auto !important; }
        h1 { font-size: 34px !important; }
        h2 { font-size: 26px !important; }
      }
      @media (prefers-color-scheme: dark) {
        body, table { background-color: ${IVORY} !important; }
      }
    </style>
  `;

  const preheaderHtml = preheader
    ? `<div style="display:none;overflow:hidden;line-height:1px;opacity:0;max-height:0;max-width:0;visibility:hidden;font-size:1px;color:${IVORY};">${esc(preheader)}</div>`
    : "";

  const parts = visible
    .map((s) => renderSection(s, ctx, settings, assetsBySlot))
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="format-detection" content="telephone=no" />
  <title>${esc(settings.company.companyName)}</title>
  ${styleBlock}
</head>
<body style="margin:0;padding:0;background-color:${IVORY};-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">
  ${preheaderHtml}
  ${containerOpen()}
    ${parts}
  ${containerClose()}
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
    if (heroSection.data.headline) lines.push(personalize(heroSection.data.headline, ctx).replace(/\n/g, " "));
    if (heroSection.data.body) lines.push(personalize(heroSection.data.body, ctx));
    lines.push("");
  }
  const formats = template.sections.find((s) => s.type === "formats" && s.visible);
  if (formats) {
    lines.push("Available formats:");
    if (formats.data.format1Title) lines.push(`  - ${formats.data.format1Title}: ${formats.data.format1Body ?? ""}`.trim());
    if (formats.data.format2Title) lines.push(`  - ${formats.data.format2Title}: ${formats.data.format2Body ?? ""}`.trim());
    if (formats.data.format3Title) lines.push(`  - ${formats.data.format3Title}: ${formats.data.format3Body ?? ""}`.trim());
    lines.push("");
  }
  const packing = template.sections.find((s) => s.type === "packing" && s.visible);
  if (packing?.data.body) {
    lines.push(personalize(packing.data.body, ctx));
    lines.push("");
  }
  const heritage = template.sections.find((s) => s.type === "heritage" && s.visible);
  if (heritage?.data.body) {
    lines.push(personalize(heritage.data.body, ctx));
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
  lines.push(c.tagline);
  lines.push(c.heritage);
  lines.push(c.location);
  lines.push(c.website);
  lines.push(c.email);
  return lines.filter((l) => l !== undefined).join("\n");
}
