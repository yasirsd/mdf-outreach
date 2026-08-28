import type {
  ActivityEvent,
  AssetRecord,
  Buyer,
  Campaign,
  CampaignRecipient,
  EmailTemplate,
  WorkspaceBackup,
  WorkspaceSettings,
} from "@/lib/types";
import type {
  BuyerCandidate,
  BuyerCandidateContact,
  BuyerCandidateProductMatch,
  BuyerTypeOption,
  ContactPriorityId,
} from "@/lib/buyerFinder/types";
import type { BusinessProductId } from "@/lib/buyerFinder/types";
import type {
  BuyerFinderSearchRun,
  SearchRunPatch,
} from "@/lib/buyerFinder/searchRun";

export interface BuyerListFilter {
  search?: string;
  status?: string;
  country?: string;
  product?: string;
}

export interface PaginatedBuyerQuery extends BuyerListFilter {
  page: number;
  pageSize: number;
}

export interface PaginatedBuyers {
  rows: Buyer[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

export interface BuyerRepository {
  list(): Promise<Buyer[]>;
  /**
   * F8 — server-side paginated + filtered read for the Buyers page.
   *
   * • Ordering: `updated_at DESC` (matches `list()`).
   * • Search covers company, first name, last name, email — case-insensitive.
   * • Filters are AND-composed.
   * • RLS scopes to the caller's workspace automatically.
   * • `page` is 1-indexed; `pageSize` is clamped to [1, 200].
   * • Return payload includes the exact `total` for the current filter,
   *   so the UI never has to fetch the whole list to know how many pages
   *   there are.
   */
  listPaginated(query: PaginatedBuyerQuery): Promise<PaginatedBuyers>;
  get(id: string): Promise<Buyer | undefined>;
  /**
   * Load only the buyers whose ids are provided. Workspace-scoped via
   * RLS. Empty input returns immediately without a DB query. Handles
   * chunking internally when the input exceeds the practical PostgREST
   * IN-list size. Duplicate ids are de-duplicated.
   *
   * Prefer this over `list()` on campaign paths where only recipient
   * buyers are needed — avoids loading every workspace buyer per tab.
   */
  listByIds(ids: string[]): Promise<Buyer[]>;
  create(buyer: Buyer): Promise<Buyer>;
  update(id: string, patch: Partial<Buyer>): Promise<Buyer>;
  delete(id: string): Promise<void>;
  bulkPut(buyers: Buyer[]): Promise<void>;
  findByEmail(email: string): Promise<Buyer | undefined>;
}

export interface CampaignRepository {
  list(): Promise<Campaign[]>;
  get(id: string): Promise<Campaign | undefined>;
  create(campaign: Campaign): Promise<Campaign>;
  update(id: string, patch: Partial<Campaign>): Promise<Campaign>;
  delete(id: string): Promise<void>;
  bulkPut(campaigns: Campaign[]): Promise<void>;
}

export interface RecipientRepository {
  listByCampaign(campaignId: string): Promise<CampaignRecipient[]>;
  add(recipient: CampaignRecipient): Promise<CampaignRecipient>;
  update(id: string, patch: Partial<CampaignRecipient>): Promise<CampaignRecipient>;
  remove(id: string): Promise<void>;
  bulkPut(recipients: CampaignRecipient[]): Promise<void>;
  find(campaignId: string, buyerId: string): Promise<CampaignRecipient | undefined>;
}

export interface TemplateFilter {
  themeKey?: string;
  variant?: "signature" | "direct";
  status?: "draft" | "approved" | "archived";
}

export interface TemplateRepository {
  list(): Promise<EmailTemplate[]>;
  /**
   * Server-side filtered list. Empty filter is equivalent to `list()`.
   * Any combination of themeKey / variant / status may be supplied.
   * Workspace-scoped via RLS.
   */
  listByFilter(filter: TemplateFilter): Promise<EmailTemplate[]>;
  get(id: string): Promise<EmailTemplate | undefined>;
  create(t: EmailTemplate): Promise<EmailTemplate>;
  update(id: string, patch: Partial<EmailTemplate>): Promise<EmailTemplate>;
  delete(id: string): Promise<void>;
  bulkPut(templates: EmailTemplate[]): Promise<void>;
}

export interface AssetRepository {
  list(): Promise<AssetRecord[]>;
  get(id: string): Promise<AssetRecord | undefined>;
  findBySlot(themeKey: string, slot: string): Promise<AssetRecord | undefined>;
  put(asset: AssetRecord): Promise<AssetRecord>;
  patch(id: string, patch: Partial<AssetRecord>): Promise<AssetRecord>;
  delete(id: string): Promise<void>;
  bulkPut(assets: AssetRecord[]): Promise<void>;
}

export interface ActivityRepository {
  list(limit?: number): Promise<ActivityEvent[]>;
  add(ev: ActivityEvent): Promise<ActivityEvent>;
  clear(): Promise<void>;
  bulkPut(events: ActivityEvent[]): Promise<void>;
}

export interface SettingsRepository {
  get(): Promise<WorkspaceSettings | undefined>;
  put(settings: WorkspaceSettings): Promise<WorkspaceSettings>;
}

export interface WorkspaceService {
  exportBackup(): Promise<WorkspaceBackup>;
  importBackup(backup: WorkspaceBackup, mode: "replace" | "merge"): Promise<void>;
  clearDemoData(): Promise<void>;
  resetAll(): Promise<void>;
}

export interface BuyerCandidateRepository {
  list(): Promise<BuyerCandidate[]>;
  get(id: string): Promise<BuyerCandidate | undefined>;
  create(input: BuyerCandidate): Promise<BuyerCandidate>;
  update(id: string, patch: Partial<BuyerCandidate>): Promise<BuyerCandidate>;
  delete(id: string): Promise<void>;
  findByDomain(domain: string): Promise<BuyerCandidate | undefined>;
}

export interface BuyerCandidateContactRepository {
  listByCandidate(candidateId: string): Promise<BuyerCandidateContact[]>;
  get(id: string): Promise<BuyerCandidateContact | undefined>;
  create(input: BuyerCandidateContact): Promise<BuyerCandidateContact>;
  update(id: string, patch: Partial<BuyerCandidateContact>): Promise<BuyerCandidateContact>;
  delete(id: string): Promise<void>;
  findByEmail(email: string): Promise<BuyerCandidateContact | undefined>;
  findByProviderRef(source: string, providerRef: string): Promise<BuyerCandidateContact | undefined>;
}

export interface BuyerCandidateProductMatchRepository {
  listByCandidate(candidateId: string): Promise<BuyerCandidateProductMatch[]>;
  create(input: BuyerCandidateProductMatch): Promise<BuyerCandidateProductMatch>;
  update(id: string, patch: Partial<BuyerCandidateProductMatch>): Promise<BuyerCandidateProductMatch>;
  delete(id: string): Promise<void>;
  findByCandidateAndProduct(
    candidateId: string,
    productId: BusinessProductId,
  ): Promise<BuyerCandidateProductMatch | undefined>;
}

/**
 * BF2.2 — Search Run persistence.
 *
 * Workspace isolation comes from the request-scoped authenticated
 * Supabase client + RLS. Callers never pass a browser-supplied
 * workspaceId; `create` stamps the constructor workspace.
 */
export interface BuyerFinderSearchRunCreateInput {
  country: string;
  businessProductId: string;
  desiredBuyerTypes: BuyerTypeOption[];
  contactPriorities: ContactPriorityId[];
}

export class SearchRunActiveExistsError extends Error {
  readonly code = "ACTIVE_RUN_EXISTS" as const;
  constructor() {
    super("A Buyer Finder search is already running.");
    this.name = "SearchRunActiveExistsError";
  }
}

export interface BuyerFinderSearchRunRepository {
  create(input: BuyerFinderSearchRunCreateInput): Promise<BuyerFinderSearchRun>;
  get(id: string): Promise<BuyerFinderSearchRun | undefined>;
  update(id: string, patch: SearchRunPatch): Promise<BuyerFinderSearchRun>;
  /** Newest queued or running run for this workspace, if any. */
  getLatestActive(): Promise<BuyerFinderSearchRun | undefined>;
  /**
   * Atomic queued → running claim. Returns the claimed row, or
   * `undefined` when the row is missing, already running, or terminal.
   * Exactly one concurrent caller can succeed.
   */
  claimQueued(id: string): Promise<BuyerFinderSearchRun | undefined>;
}
