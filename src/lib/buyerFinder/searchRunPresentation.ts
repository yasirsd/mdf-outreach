import { BUYER_FINDER_PROCESS_CAP, type SafeSearchRunSnapshot, type SearchRunStage } from "./searchRun";
import { INTERRUPTED_ERROR_CODE, isRunStale, isTerminal, stageIndex } from "./searchRun";
import { getProviderDescriptor } from "./providers/descriptors";
import {
  discoveringStepTitle,
  hunterCodeToSafeMessage,
  INTERRUPTED_MESSAGE,
  providerOutcomeLabel,
  STAGE_LABEL,
} from "./searchRunCopy";

export type ProgressStepState = "completed" | "active" | "waiting" | "warning" | "failed";

export interface ProgressStep {
  id: Exclude<SearchRunStage, "complete">;
  label: string;
  detail?: string;
  state: ProgressStepState;
}

export type SearchRunViewKind = "progress" | "complete" | "partial" | "failed" | "interrupted";

export interface SearchRunViewModel {
  kind: SearchRunViewKind;
  title: string;
  subtitle?: string;
  steps: ProgressStep[];
  /** Determinate bar only during processing_candidates. */
  bar: { processed: number; total: number } | null;
  details: Array<{ label: string; value: string }>;
  message?: string;
}

const STEP_ORDER: Array<Exclude<SearchRunStage, "complete">> = [
  "preparing",
  "discovering",
  "processing_candidates",
  "finalizing",
];

export function providerDisplayName(provider: string): string {
  return getProviderDescriptor(provider)?.displayName ?? provider;
}

export function capabilityLabel(provider: string): string {
  const d = getProviderDescriptor(provider);
  if (!d) return "Company discovery";
  if (d.capabilities.company_discovery === "free" || d.capabilities.company_discovery === "paid") {
    return "Company discovery";
  }
  return "Company discovery";
}

function stepState(
  step: Exclude<SearchRunStage, "complete">,
  current: SearchRunStage,
  kind: SearchRunViewKind,
): ProgressStepState {
  if (kind === "failed" && step === current) return "failed";
  if (kind === "failed" && stageIndex(step) > stageIndex(current === "complete" ? "finalizing" : current)) {
    return "waiting";
  }
  if (current === "complete") return "completed";
  if (step === current) return "active";
  if (stageIndex(step) < stageIndex(current)) return "completed";
  return "waiting";
}

function discoveringDetail(run: SafeSearchRunSnapshot, state: ProgressStepState): string | undefined {
  const name = providerDisplayName(run.provider);
  if (state === "active") return `Free · ${run.creditsUsed} credits`;
  if (state === "completed" && run.discoveredCount > 0) {
    return `${run.discoveredCount} ${run.discoveredCount === 1 ? "company" : "companies"} discovered`;
  }
  if (state === "completed") return `${name} · Free`;
  return undefined;
}

function processingDetail(run: SafeSearchRunSnapshot, state: ProgressStepState): string | undefined {
  if (state === "active" || state === "completed") {
    if (run.usableCount > 0) return `${run.processedCount} / ${run.usableCount} checked`;
  }
  return undefined;
}

export function buildSearchRunDetails(run: SafeSearchRunSnapshot): Array<{ label: string; value: string }> {
  const name = providerDisplayName(run.provider);
  return [
    { label: "Provider", value: name },
    { label: "Capability", value: capabilityLabel(run.provider) },
    { label: "Cost", value: run.costClass === "free" ? "Free" : "Paid" },
    { label: "Credits used", value: String(run.creditsUsed) },
    { label: "Companies discovered", value: String(run.discoveredCount) },
    { label: "Provider status", value: providerOutcomeLabel(run.providerStatus) },
  ];
}

export function deriveSearchRunView(
  run: SafeSearchRunSnapshot,
  now: Date = new Date(),
  extras?: { productDisplayName?: string },
): SearchRunViewModel {
  const interrupted = isRunStale(run, now);
  const kind: SearchRunViewKind = interrupted
    ? "interrupted"
    : run.status === "completed"
      ? "complete"
      : run.status === "partial"
        ? "partial"
        : run.status === "failed"
          ? "failed"
          : "progress";

  const visualStage: SearchRunStage =
    run.stage === "complete" && !isTerminal(run.status) ? "finalizing" : run.stage;

  const steps: ProgressStep[] = STEP_ORDER.map((id) => {
    const state = stepState(id, visualStage, kind);
    const label =
      id === "discovering"
        ? discoveringStepTitle(providerDisplayName(run.provider))
        : STAGE_LABEL[id];
    let detail: string | undefined;
    if (id === "discovering") detail = discoveringDetail(run, state);
    if (id === "processing_candidates") detail = processingDetail(run, state);
    return { id, label, detail, state };
  });

  const bar =
    kind === "progress" && run.stage === "processing_candidates" && run.usableCount > 0
      ? { processed: run.processedCount, total: run.usableCount }
      : null;

  const title =
    kind === "complete"
      ? "Search complete"
      : kind === "partial"
        ? "Search partially completed"
        : kind === "failed"
          ? "Search could not complete"
          : kind === "interrupted"
            ? "Search interrupted"
            : `Finding companies in ${run.country}`;

  const subtitle =
    kind === "progress" && extras?.productDisplayName
      ? extras.productDisplayName
      : undefined;

  const message = completionOrFailureMessage(kind, run);

  return {
    kind,
    title,
    subtitle,
    steps,
    bar,
    details: buildSearchRunDetails(run),
    message,
  };
}

function completionOrFailureMessage(
  kind: SearchRunViewKind,
  run: SafeSearchRunSnapshot,
): string | undefined {
  if (kind === "failed") {
    return run.errorMessage || hunterCodeToSafeMessage(run.errorCode ?? undefined);
  }
  if (kind === "interrupted") {
    return run.errorCode === INTERRUPTED_ERROR_CODE
      ? run.errorMessage || INTERRUPTED_MESSAGE
      : INTERRUPTED_MESSAGE;
  }
  const capHint =
    run.usableCount >= BUYER_FINDER_PROCESS_CAP && run.discoveredCount > run.usableCount
      ? `${BUYER_FINDER_PROCESS_CAP} companies processed in this search.`
      : undefined;
  if (kind === "partial") {
    return capHint ? `Saved results are safe. ${capHint}` : "Saved results are safe.";
  }
  if (kind === "complete") {
    if (run.providerStatus === "no_result") {
      return run.discoveredCount > 0
        ? "No usable companies were found."
        : "No matching companies were found.";
    }
    return capHint;
  }
  return undefined;
}
