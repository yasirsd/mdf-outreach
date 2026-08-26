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
} from "@/lib/buyerFinder/types";
import type { ProductKey } from "@/lib/email/themes/types";

export interface BuyerRepository {
  list(): Promise<Buyer[]>;
  get(id: string): Promise<Buyer | undefined>;
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

export interface TemplateRepository {
  list(): Promise<EmailTemplate[]>;
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
}

export interface BuyerCandidateProductMatchRepository {
  listByCandidate(candidateId: string): Promise<BuyerCandidateProductMatch[]>;
  create(input: BuyerCandidateProductMatch): Promise<BuyerCandidateProductMatch>;
  update(id: string, patch: Partial<BuyerCandidateProductMatch>): Promise<BuyerCandidateProductMatch>;
  delete(id: string): Promise<void>;
  findByCandidateAndProduct(
    candidateId: string,
    productKey: ProductKey,
  ): Promise<BuyerCandidateProductMatch | undefined>;
}
