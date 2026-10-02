/**
 * TH04C Step 0A — Deterministic robots.txt evaluator.
 *
 * Pure. No I/O. Replaces the previous "Disallow: /"-only check with
 * a conservative, path-aware evaluator that supports:
 *
 *   - User-agent (specific name OR `*`)
 *   - Disallow (empty = allow all; `/` = block site; path-prefix otherwise)
 *   - Allow (overrides a broader Disallow when its matching prefix is longer)
 *   - Comments (`# …`) ignored
 *   - Case-insensitive directive names; path matching is case-sensitive
 *     per RFC-9309 (URL path rules).
 *
 * Where multiple Allow / Disallow rules match a path, the rule with
 * the LONGEST matching path prefix wins. If path-prefix lengths tie,
 * `Allow` wins (conservative-for-the-crawler-but-permissive-for-the-site:
 * matches Google's documented behavior and most third-party parsers).
 * Malformed inputs → treated as `blocked` for the path in question so
 * we never over-crawl due to a parsing bug.
 *
 * NOT a general-purpose crawler framework. Only what TH needs.
 */

export const DEFAULT_PUBLIC_WEBSITE_USER_AGENT = "MDF-Outreach" as const;

interface RobotsRule {
  readonly directive: "allow" | "disallow";
  /** Path prefix as written in the rules. Empty string = universal. */
  readonly path: string;
}

interface RobotsGroup {
  readonly agents: readonly string[]; // lowercased
  readonly rules: readonly RobotsRule[];
}

function parseRobots(body: string): RobotsGroup[] {
  const groups: RobotsGroup[] = [];
  if (typeof body !== "string" || !body.length) return groups;

  let currentAgents: string[] | null = null;
  let currentRules: RobotsRule[] = [];
  let lastDirectiveWasAgent = false;

  const commit = () => {
    if (currentAgents && currentAgents.length) {
      groups.push({ agents: currentAgents, rules: currentRules });
    }
    currentAgents = null;
    currentRules = [];
  };

  const lines = body.split(/\r?\n/);
  for (const rawLine of lines) {
    const noComment = rawLine.replace(/#.*$/, "").trim();
    if (!noComment) continue;
    const colon = noComment.indexOf(":");
    if (colon < 0) continue;
    const name = noComment.slice(0, colon).trim().toLowerCase();
    const value = noComment.slice(colon + 1).trim();
    if (name === "user-agent") {
      if (!lastDirectiveWasAgent) {
        commit();
        currentAgents = [];
      }
      currentAgents = currentAgents ?? [];
      currentAgents.push(value.toLowerCase());
      lastDirectiveWasAgent = true;
      continue;
    }
    lastDirectiveWasAgent = false;
    if (!currentAgents || !currentAgents.length) continue; // directive before any UA
    if (name === "disallow") {
      currentRules.push({ directive: "disallow", path: value });
    } else if (name === "allow") {
      currentRules.push({ directive: "allow", path: value });
    }
    // Other directives (Sitemap, Crawl-delay, Host) are ignored.
  }
  commit();
  return groups;
}

function pickApplicableGroup(groups: readonly RobotsGroup[], userAgent: string): RobotsGroup | undefined {
  const ua = userAgent.toLowerCase();
  // Prefer the first group that lists the UA (or a prefix of the UA
  // token before any `/`) over the wildcard. If no specific match,
  // use the wildcard.
  const uaRoot = ua.split("/")[0]!;
  for (const g of groups) {
    if (g.agents.includes(ua) || g.agents.includes(uaRoot)) return g;
  }
  for (const g of groups) {
    if (g.agents.includes("*")) return g;
  }
  return undefined;
}

function matchesPrefix(rulePath: string, requestPath: string): boolean {
  if (rulePath === "") return false; // empty Disallow / Allow is NOT a rule hit
  // Rule path may include trailing `$` (end-of-path anchor) per common extension.
  if (rulePath.endsWith("$")) {
    const trimmed = rulePath.slice(0, -1);
    return requestPath === trimmed;
  }
  // Rule may include wildcards (`*`). Convert the pattern to a regex
  // conservatively.
  if (rulePath.includes("*")) {
    const re = "^" + rulePath.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
    try { return new RegExp(re).test(requestPath); } catch { return false; }
  }
  return requestPath.startsWith(rulePath);
}

/**
 * Evaluate a request path against a parsed robots.txt body for the
 * given crawler user-agent. Returns `allowed: true` when the path is
 * fetchable, `false` otherwise. Malformed inputs return `false`
 * (conservative — do not crawl).
 */
export function isPathAllowedByRobots(
  robotsBody: string | undefined | null,
  requestPath: string,
  userAgent: string = DEFAULT_PUBLIC_WEBSITE_USER_AGENT,
): boolean {
  if (robotsBody === undefined || robotsBody === null) return true; // no robots → allowed
  if (typeof robotsBody !== "string") return false; // malformed → conservative
  if (typeof requestPath !== "string" || !requestPath.startsWith("/")) return false;
  let groups: readonly RobotsGroup[];
  try { groups = parseRobots(robotsBody); } catch { return false; }
  if (!groups.length) return true; // valid but empty → allowed
  const applicable = pickApplicableGroup(groups, userAgent);
  if (!applicable) return true;
  if (!applicable.rules.length) return true;

  // Longest-prefix wins; ties → Allow wins.
  let bestAllow = -1;
  let bestDisallow = -1;
  for (const r of applicable.rules) {
    if (!matchesPrefix(r.path, requestPath)) continue;
    const len = r.path.length;
    if (r.directive === "allow" && len > bestAllow) bestAllow = len;
    if (r.directive === "disallow" && len > bestDisallow) bestDisallow = len;
  }
  if (bestAllow < 0 && bestDisallow < 0) return true;
  if (bestDisallow < 0) return true;
  if (bestAllow < 0) {
    // `Disallow:` (empty) is NOT a rule hit by `matchesPrefix`, so a
    // literal `Disallow: /` is what blocks the whole site.
    return false;
  }
  // Tie → Allow wins (crawler-permissive). Longest wins otherwise.
  if (bestAllow >= bestDisallow) return true;
  return false;
}

/**
 * Convenience — fetch and evaluate in one call. Returns `true` when
 * the request path is allowed OR when robots.txt cannot be fetched
 * (same conservative behavior as the previous inline check).
 */
export async function robotsAllowsFetch(input: {
  host: string;
  requestPath: string;
  fetchImpl: typeof fetch;
  userAgent?: string;
  timeoutMs?: number;
}): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs ?? 3_000);
  try {
    const r = await input.fetchImpl(`https://${input.host}/robots.txt`, {
      headers: { "user-agent": input.userAgent ?? DEFAULT_PUBLIC_WEBSITE_USER_AGENT, accept: "text/plain" },
      signal: controller.signal,
    });
    if (!r.ok) return true; // no robots → allowed (same policy as before)
    const body = await r.text();
    return isPathAllowedByRobots(body, input.requestPath, input.userAgent);
  } catch {
    return true; // network failure → allowed (conservative-for-reachability)
  } finally {
    clearTimeout(timer);
  }
}
