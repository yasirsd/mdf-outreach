/**
 * Conservative robots.txt handling. Never circumvents Disallow.
 * If robots.txt cannot be fetched, crawling the public pages is still allowed.
 */

export const PUBLIC_WEBSITE_USER_AGENT = "MDFOutreach-BuyerFinder/1.0";

export function pathAllowedByRobots(robotsTxt: string | undefined, path: string): boolean {
  if (!robotsTxt) return true;
  const rules = parseRobots(robotsTxt);
  const cleaned = path.startsWith("/") ? path : `/${path}`;
  for (const prefix of rules) {
    if (cleaned.startsWith(prefix)) return false;
  }
  return true;
}

function parseRobots(text: string): string[] {
  const disallows: string[] = [];
  let applies = false;
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.replace(/#.*$/, "").trim();
    if (!trimmed) continue;
    const idx = trimmed.indexOf(":");
    if (idx < 0) continue;
    const key = trimmed.slice(0, idx).trim().toLowerCase();
    const value = trimmed.slice(idx + 1).trim();
    if (key === "user-agent") {
      const ua = value.toLowerCase();
      applies = ua === "*" || ua.includes("mdfoutreach");
      continue;
    }
    if (!applies) continue;
    if (key === "disallow") {
      if (value) disallows.push(value);
    }
    if (key === "allow" && value === "/") {
      // explicit allow-all for this group; keep prior disallows from other groups
    }
  }
  return disallows;
}
