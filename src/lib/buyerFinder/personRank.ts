/**
 * Deterministic MDF person ranking for Buyer Finder.
 * Title matching uses whole tokens / phrases — never "import" inside "important".
 */

import { scoreContactRole, type RoleScore } from "./scoring";

export const PERSON_PERSIST_CAP = 8;

export type SeniorityRank = 0 | 1 | 2 | 3;

export interface RankablePerson {
  jobTitle: string;
  isDecisionMaker?: boolean;
  seniority?: string;
  fullName: string;
  providerRef?: string;
}

export function seniorityRank(value: string | null | undefined): SeniorityRank {
  const s = (value ?? "").trim().toLowerCase();
  if (s === "executive") return 3;
  if (s === "senior") return 2;
  if (s === "junior") return 1;
  return 0;
}

export function roleScoreForTitle(jobTitle: string | null | undefined): RoleScore {
  return scoreContactRole(jobTitle);
}

/**
 * Tie-break for primary contact when contactScore is equal:
 * 1. role points
 * 2. decision_maker true first
 * 3. seniority (executive > senior > junior > unknown)
 * 4. normalized name
 * 5. providerRef
 */
export function comparePeopleForPrimary(a: RankablePerson, b: RankablePerson): number {
  const roleDelta = roleScoreForTitle(b.jobTitle).points - roleScoreForTitle(a.jobTitle).points;
  if (roleDelta !== 0) return roleDelta;
  const dm = Number(Boolean(b.isDecisionMaker)) - Number(Boolean(a.isDecisionMaker));
  if (dm !== 0) return dm;
  const sen = seniorityRank(b.seniority) - seniorityRank(a.seniority);
  if (sen !== 0) return sen;
  const name = (a.fullName ?? "").trim().toLowerCase().localeCompare((b.fullName ?? "").trim().toLowerCase());
  if (name !== 0) return name;
  return (a.providerRef ?? "").localeCompare(b.providerRef ?? "");
}
