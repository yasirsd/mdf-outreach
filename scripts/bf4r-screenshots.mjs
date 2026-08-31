import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const out = "docs/bf4r-screenshots";
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
await page.goto("http://localhost:3000/bf4r-visual", { waitUntil: "networkidle" });

async function shot(name, click, viewport) {
  if (viewport) await page.setViewportSize(viewport);
  if (click) await page.click(`[data-shot="${click}"]`);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${out}/${name}.png`, fullPage: true });
}

await shot("all-companies-1440", "all", { width: 1440, height: 1100 });
await shot("priority-contacts-1440", "priority");
await shot("needs-attention-1440", "attention");
await shot("ksons-detail-1440", "detail");
await shot("search-1440", "search");
await shot("priority-contacts-768", "priority", { width: 768, height: 1100 });

await browser.close();
console.log(`wrote screenshots to ${out}`);
