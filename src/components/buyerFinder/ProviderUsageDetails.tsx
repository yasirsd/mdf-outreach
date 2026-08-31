import { Badge } from "@/components/ui/Badge";
import { cn } from "@/lib/utils";
import type { HunterRevealAvailability } from "@/lib/buyerFinder/hunterRevealAvailability";
import {
  formatUsageResetDate,
  usageLevel,
  type ProviderUsage,
  type UsageBucket,
  type UsageLevel,
} from "@/lib/buyerFinder/usage";

const LEVEL_BAR: Record<UsageLevel, string> = {
  normal: "#86EFAC",
  attention: "#EBC275",
  low: "var(--brand-orange)",
  critical: "#F08B7E",
};

function BucketBlock({ title, bucket }: { title: string; bucket: UsageBucket }) {
  const level = usageLevel(bucket.percentUsed);
  const bar = LEVEL_BAR[level];
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 mb-2">
        <div className="text-[12.5px] font-medium text-text-primary">{title}</div>
        <div className="text-[12px] tabular-nums text-text-secondary">
          {bucket.remaining} remaining
        </div>
      </div>
      <div
        role="progressbar"
        aria-label={`${title} usage`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(bucket.percentUsed)}
        className="h-1.5 rounded-full overflow-hidden"
        style={{ backgroundColor: "var(--app-hover)" }}
      >
        <div
          className="h-full rounded-full"
          style={{ width: `${bucket.percentUsed}%`, backgroundColor: bar }}
        />
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-text-muted tabular-nums">
        <span>{bucket.used} used</span>
        <span>{bucket.remaining} remaining</span>
        <span>{bucket.available} available</span>
      </div>
    </div>
  );
}

export function ProviderUsageDetails({
  usage,
  hunterReveal = "disabled",
}: {
  usage: ProviderUsage;
  hunterReveal?: HunterRevealAvailability;
}) {
  const resetLabel = formatUsageResetDate(usage.resetDate);
  const hasUnified = Boolean(usage.unifiedCredits);
  const hasSplit = Boolean(usage.searches || usage.verifications);

  return (
    <div className="px-6 py-5 space-y-6">
      <section>
        <div className="text-[10.5px] tracking-[0.16em] uppercase text-text-muted font-medium mb-3">
          Plan usage
        </div>
        <div className="space-y-5">
          {usage.unifiedCredits && <BucketBlock title="Credits" bucket={usage.unifiedCredits} />}
          {usage.searches && <BucketBlock title="Search credits" bucket={usage.searches} />}
          {usage.verifications && (
            <BucketBlock title="Verification credits" bucket={usage.verifications} />
          )}
          {!hasUnified && !hasSplit && (
            <p className="text-[12.5px] text-text-muted">No quota data for this provider yet.</p>
          )}
        </div>
      </section>

      <section>
        <div className="text-[10.5px] tracking-[0.16em] uppercase text-text-muted font-medium mb-2">
          Reset
        </div>
        {resetLabel ? (
          <p className="text-[13px] text-text-primary">Resets {resetLabel}</p>
        ) : (
          <p className="text-[13px] text-text-muted">Reset date unavailable</p>
        )}
      </section>

      <section>
        <div className="text-[10.5px] tracking-[0.16em] uppercase text-text-muted font-medium mb-3">
          What consumes credits
        </div>
        <ul className="space-y-3">
          <li className="flex items-start justify-between gap-3">
            <div>
              <div className="text-[13px] text-text-primary">Company discovery</div>
              <div className="text-[12px] text-text-muted">Hunter Discover</div>
            </div>
            <Badge tone="success">FREE · 0 credits</Badge>
          </li>
          <li className="flex items-start justify-between gap-3">
            <div>
              <div className="text-[13px] text-text-primary">Decision-maker discovery</div>
              <div className="text-[12px] text-text-muted">Hunter Multi-Domain Search (masked)</div>
            </div>
            <Badge tone="success">FREE · 0 credits</Badge>
          </li>
          <li className="flex items-start justify-between gap-3">
            <div>
              <div className="text-[13px] text-text-primary">
                {hunterReveal === "ready" ? "Personal contact reveal" : "Email/contact reveal"}
              </div>
              <div className="text-[12px] text-text-muted">
                {hunterReveal === "ready"
                  ? "Up to 1 Hunter Search credit per person"
                  : "Reveal, Domain Search, Email Finder"}
              </div>
            </div>
            {hunterReveal === "ready" ? (
              <Badge tone="warning">UP TO 1 CREDIT</Badge>
            ) : (
              <Badge tone="neutral">LOCKED</Badge>
            )}
          </li>
          <li className="flex items-start justify-between gap-3">
            <div>
              <div className="text-[13px] text-text-primary">Email verification</div>
              <div className="text-[12px] text-text-muted">Email Verifier</div>
            </div>
            <Badge tone="warning">USES CREDITS</Badge>
          </li>
        </ul>
      </section>

      <p className={cn("text-[12px] text-text-muted leading-relaxed")}>
        Live usage will be enabled with provider connection. This panel currently shows mock
        quota data.
      </p>
    </div>
  );
}
