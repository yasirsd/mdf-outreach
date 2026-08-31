import type { PublicWebsiteAvailability } from "@/lib/buyerFinder/publicWebsiteAvailability";

/**
 * Buyer Finder capability chip. Not Hunter usage — never mixed into
 * Hunter credit accounting. Public website research is always free.
 */
export function PublicWebsiteCapabilityChip({
  state: _state = "ready",
}: {
  state?: PublicWebsiteAvailability;
}) {
  return (
    <span
      className="inline-flex items-center gap-1.5 whitespace-nowrap"
      aria-label="Company website contacts · Free"
    >
      <span className="text-[11.5px] font-medium text-text-secondary">Website</span>
      <span className="text-[11.5px] text-text-muted">Contacts · Free</span>
    </span>
  );
}
