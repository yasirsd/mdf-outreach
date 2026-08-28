import type { SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { EMAIL_ASSET_CONFLICT_TARGET } from "@/lib/assets/conflictTargets";
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
  ActivityRepository,
  AssetRepository,
  BuyerCandidateContactRepository,
  BuyerCandidateProductMatchRepository,
  BuyerCandidateRepository,
  BuyerFinderSearchRunRepository,
  BuyerRepository,
  CampaignRepository,
  PaginatedBuyerQuery,
  PaginatedBuyers,
  RecipientRepository,
  SettingsRepository,
  TemplateRepository,
  WorkspaceService,
} from "../interfaces";
import {
  activityFromRow,
  activityToRow,
  assetFromRow,
  assetToPatchRow,
  assetToRow,
  buyerFromRow,
  buyerToPatchRow,
  buyerToRow,
  campaignFromRow,
  campaignToPatchRow,
  campaignToRow,
  recipientFromRow,
  recipientToPatchRow,
  recipientToRow,
  settingsFromRow,
  settingsToRow,
  templateFromRow,
  templateToPatchRow,
  templateToRow,
} from "./mappers";
import { createBuyerCandidateRepository } from "./buyerCandidateRepository";
import { createBuyerCandidateContactRepository } from "./buyerCandidateContactRepository";
import { createBuyerCandidateProductMatchRepository } from "./buyerCandidateProductMatchRepository";
import { createBuyerFinderSearchRunRepository } from "./buyerFinderSearchRunRepository";

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.min(hi, Math.max(lo, Math.floor(n)));
}

/**
 * PostgREST OR filter syntax uses commas and parentheses as delimiters.
 * A search term containing those characters could otherwise inject
 * additional filter branches. We strip / escape the small set of chars
 * PostgREST treats as structural.
 */
function escapeOrValue(s: string): string {
  return s.replace(/[,()]/g, "");
}

function idFor(patchId: string | undefined): string {
  if (patchId && isUuid(patchId)) return patchId;
  return randomUUID();
}

function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

class SupabaseBuyerRepository implements BuyerRepository {
  constructor(private supabase: SupabaseClient, private workspaceId: string) {}

  async list(): Promise<Buyer[]> {
    const { data, error } = await this.supabase
      .from("buyers")
      .select("*")
      .order("updated_at", { ascending: false });
    if (error) throw error;
    return (data ?? []).map(buyerFromRow);
  }

  /**
   * F8 — server-side paginated + filtered read. See BuyerRepository.
   * Uses PostgREST `count: 'exact'` so `total` is authoritative; RLS
   * still applies via the request-scoped Supabase client.
   */
  async listPaginated(query: PaginatedBuyerQuery): Promise<PaginatedBuyers> {
    const pageSize = clamp(query.pageSize, 1, 200);
    const page = Math.max(1, Math.floor(query.page || 1));
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    let q = this.supabase
      .from("buyers")
      .select("*", { count: "exact" })
      .order("updated_at", { ascending: false })
      .range(from, to);

    if (query.status?.trim()) q = q.eq("status", query.status.trim());
    if (query.country?.trim()) q = q.eq("country", query.country.trim());
    if (query.product?.trim()) q = q.eq("product_interest", query.product.trim());

    const search = query.search?.trim();
    if (search) {
      // Bound the search string length and escape PostgREST OR delimiters
      // so a user searching for a literal comma/parenthesis cannot inject
      // filter syntax. 128 chars covers real-world buyer/company names
      // with room to spare and prevents ridiculous URL payloads.
      const s = escapeOrValue(search.slice(0, 128));
      q = q.or(
        `company.ilike.*${s}*,first_name.ilike.*${s}*,last_name.ilike.*${s}*,email.ilike.*${s}*`,
      );
    }

    const { data, error, count } = await q;
    if (error) throw error;
    const total = count ?? 0;
    return {
      rows: (data ?? []).map(buyerFromRow),
      total,
      page,
      pageSize,
      pageCount: total === 0 ? 0 : Math.ceil(total / pageSize),
    };
  }

  async get(id: string): Promise<Buyer | undefined> {
    const { data, error } = await this.supabase
      .from("buyers")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    return data ? buyerFromRow(data) : undefined;
  }

  async create(b: Buyer): Promise<Buyer> {
    const row = buyerToRow({ ...b, id: idFor(b.id) }, this.workspaceId);
    const { data, error } = await this.supabase
      .from("buyers")
      .insert(row)
      .select("*")
      .single();
    if (error) throw error;
    return buyerFromRow(data);
  }

  async update(id: string, patch: Partial<Buyer>): Promise<Buyer> {
    const updateFields = buyerToPatchRow(patch);
    const { data, error } = await this.supabase
      .from("buyers")
      .update(updateFields)
      .eq("id", id)
      .select("*")
      .single();
    if (error) throw error;
    return buyerFromRow(data);
  }

  async delete(id: string): Promise<void> {
    const { error } = await this.supabase.from("buyers").delete().eq("id", id);
    if (error) throw error;
  }

  async bulkPut(buyers: Buyer[]): Promise<void> {
    if (!buyers.length) return;
    const rows = buyers.map((b) => buyerToRow({ ...b, id: idFor(b.id) }, this.workspaceId));
    const { error } = await this.supabase.from("buyers").upsert(rows);
    if (error) throw error;
  }

  async findByEmail(email: string): Promise<Buyer | undefined> {
    const { data, error } = await this.supabase
      .from("buyers")
      .select("*")
      .ilike("email", email)
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return data ? buyerFromRow(data) : undefined;
  }

  /**
   * Workspace-scoped fetch of only the requested buyer ids. Chunked so
   * a huge id list still round-trips safely — PostgREST's `in.(...)`
   * URL has practical length limits.
   */
  async listByIds(ids: string[]): Promise<Buyer[]> {
    if (ids.length === 0) return [];
    const unique = Array.from(new Set(ids));
    const CHUNK = 200;
    const results: Buyer[] = [];
    for (let i = 0; i < unique.length; i += CHUNK) {
      const slice = unique.slice(i, i + CHUNK);
      const { data, error } = await this.supabase
        .from("buyers")
        .select("*")
        .in("id", slice);
      if (error) throw error;
      for (const row of data ?? []) results.push(buyerFromRow(row));
    }
    return results;
  }
}

class SupabaseCampaignRepository implements CampaignRepository {
  constructor(private supabase: SupabaseClient, private workspaceId: string) {}

  async list(): Promise<Campaign[]> {
    const { data, error } = await this.supabase
      .from("campaigns")
      .select("*")
      .order("updated_at", { ascending: false });
    if (error) throw error;
    return (data ?? []).map(campaignFromRow);
  }

  async get(id: string): Promise<Campaign | undefined> {
    const { data, error } = await this.supabase
      .from("campaigns")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    return data ? campaignFromRow(data) : undefined;
  }

  async create(c: Campaign): Promise<Campaign> {
    const row = campaignToRow({ ...c, id: idFor(c.id) }, this.workspaceId);
    const { data, error } = await this.supabase
      .from("campaigns")
      .insert(row)
      .select("*")
      .single();
    if (error) throw error;
    return campaignFromRow(data);
  }

  async update(id: string, patch: Partial<Campaign>): Promise<Campaign> {
    const updateFields = campaignToPatchRow(patch);
    const { data, error } = await this.supabase
      .from("campaigns")
      .update(updateFields)
      .eq("id", id)
      .select("*")
      .single();
    if (error) throw error;
    return campaignFromRow(data);
  }

  async delete(id: string): Promise<void> {
    const { error } = await this.supabase.from("campaigns").delete().eq("id", id);
    if (error) throw error;
  }

  async bulkPut(campaigns: Campaign[]): Promise<void> {
    if (!campaigns.length) return;
    const rows = campaigns.map((c) => campaignToRow({ ...c, id: idFor(c.id) }, this.workspaceId));
    const { error } = await this.supabase.from("campaigns").upsert(rows);
    if (error) throw error;
  }
}

class SupabaseRecipientRepository implements RecipientRepository {
  constructor(private supabase: SupabaseClient, private workspaceId: string) {}

  async listByCampaign(campaignId: string): Promise<CampaignRecipient[]> {
    const { data, error } = await this.supabase
      .from("campaign_recipients")
      .select("*")
      .eq("campaign_id", campaignId);
    if (error) throw error;
    return (data ?? []).map(recipientFromRow);
  }

  async add(r: CampaignRecipient): Promise<CampaignRecipient> {
    const row = recipientToRow({ ...r, id: idFor(r.id) }, this.workspaceId);
    const { data, error } = await this.supabase
      .from("campaign_recipients")
      .upsert(row, { onConflict: "campaign_id,buyer_id" })
      .select("*")
      .single();
    if (error) throw error;
    return recipientFromRow(data);
  }

  async update(id: string, patch: Partial<CampaignRecipient>): Promise<CampaignRecipient> {
    const fields = recipientToPatchRow(patch);
    const { data, error } = await this.supabase
      .from("campaign_recipients")
      .update(fields)
      .eq("id", id)
      .select("*")
      .single();
    if (error) throw error;
    return recipientFromRow(data);
  }

  async remove(id: string): Promise<void> {
    const { error } = await this.supabase.from("campaign_recipients").delete().eq("id", id);
    if (error) throw error;
  }

  async bulkPut(recipients: CampaignRecipient[]): Promise<void> {
    if (!recipients.length) return;
    const rows = recipients.map((r) =>
      recipientToRow({ ...r, id: idFor(r.id) }, this.workspaceId),
    );
    const { error } = await this.supabase
      .from("campaign_recipients")
      .upsert(rows, { onConflict: "campaign_id,buyer_id" });
    if (error) throw error;
  }

  async find(campaignId: string, buyerId: string): Promise<CampaignRecipient | undefined> {
    const { data, error } = await this.supabase
      .from("campaign_recipients")
      .select("*")
      .eq("campaign_id", campaignId)
      .eq("buyer_id", buyerId)
      .maybeSingle();
    if (error) throw error;
    return data ? recipientFromRow(data) : undefined;
  }
}

class SupabaseTemplateRepository implements TemplateRepository {
  constructor(private supabase: SupabaseClient, private workspaceId: string) {}

  async list(): Promise<EmailTemplate[]> {
    const { data, error } = await this.supabase.from("email_templates").select("*");
    if (error) throw error;
    return (data ?? []).map(templateFromRow);
  }

  async listByFilter(filter: {
    themeKey?: string;
    variant?: "signature" | "direct";
    status?: "draft" | "approved" | "archived";
  }): Promise<EmailTemplate[]> {
    let query = this.supabase.from("email_templates").select("*");
    if (filter.themeKey) query = query.eq("theme_key", filter.themeKey);
    if (filter.variant) query = query.eq("variant", filter.variant);
    if (filter.status) query = query.eq("status", filter.status);
    const { data, error } = await query;
    if (error) throw error;
    return (data ?? []).map(templateFromRow);
  }

  async get(id: string): Promise<EmailTemplate | undefined> {
    const { data, error } = await this.supabase
      .from("email_templates")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    return data ? templateFromRow(data) : undefined;
  }

  async create(t: EmailTemplate): Promise<EmailTemplate> {
    const row = templateToRow({ ...t, id: idFor(t.id) }, this.workspaceId);
    const { data, error } = await this.supabase
      .from("email_templates")
      .insert(row)
      .select("*")
      .single();
    if (error) throw error;
    return templateFromRow(data);
  }

  async update(id: string, patch: Partial<EmailTemplate>): Promise<EmailTemplate> {
    const updateFields = templateToPatchRow(patch);
    const { data, error } = await this.supabase
      .from("email_templates")
      .update(updateFields)
      .eq("id", id)
      .select("*")
      .single();
    if (error) throw error;
    return templateFromRow(data);
  }

  async delete(id: string): Promise<void> {
    const { error } = await this.supabase.from("email_templates").delete().eq("id", id);
    if (error) throw error;
  }

  async bulkPut(templates: EmailTemplate[]): Promise<void> {
    if (!templates.length) return;
    const rows = templates.map((t) => templateToRow({ ...t, id: idFor(t.id) }, this.workspaceId));
    const { error } = await this.supabase.from("email_templates").upsert(rows);
    if (error) throw error;
  }
}

class SupabaseAssetRepository implements AssetRepository {
  constructor(private supabase: SupabaseClient, private workspaceId: string) {}

  async list(): Promise<AssetRecord[]> {
    const { data, error } = await this.supabase.from("email_assets").select("*");
    if (error) throw error;
    return (data ?? []).map(assetFromRow);
  }

  async get(id: string): Promise<AssetRecord | undefined> {
    const { data, error } = await this.supabase
      .from("email_assets")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    return data ? assetFromRow(data) : undefined;
  }

  async findBySlot(themeKey: string, slot: string): Promise<AssetRecord | undefined> {
    const { data, error } = await this.supabase
      .from("email_assets")
      .select("*")
      .eq("theme_key", themeKey)
      .eq("slot", slot)
      .maybeSingle();
    if (error) throw error;
    return data ? assetFromRow(data) : undefined;
  }

  async put(a: AssetRecord): Promise<AssetRecord> {
    const row = assetToRow({ ...a, id: idFor(a.id) }, this.workspaceId);
    // Upsert on (workspace, theme_key, slot) when theme_key is present.
    // NOTE: this string is the single source of truth mirrored in the DB
    // unique index — see src/lib/assets/conflictTargets.ts.
    const onConflict = a.themeKey ? EMAIL_ASSET_CONFLICT_TARGET : "id";
    const { data, error } = await this.supabase
      .from("email_assets")
      .upsert(row, { onConflict })
      .select("*")
      .single();
    if (error) throw error;
    return assetFromRow(data);
  }

  async patch(id: string, patch: Partial<AssetRecord>): Promise<AssetRecord> {
    const fields = assetToPatchRow(patch);
    const { data, error } = await this.supabase
      .from("email_assets")
      .update(fields)
      .eq("id", id)
      .select("*")
      .single();
    if (error) throw error;
    return assetFromRow(data);
  }

  async delete(id: string): Promise<void> {
    const { error } = await this.supabase.from("email_assets").delete().eq("id", id);
    if (error) throw error;
  }

  async bulkPut(assets: AssetRecord[]): Promise<void> {
    if (!assets.length) return;
    const rows = assets.map((a) => assetToRow({ ...a, id: idFor(a.id) }, this.workspaceId));
    const { error } = await this.supabase
      .from("email_assets")
      .upsert(rows, { onConflict: EMAIL_ASSET_CONFLICT_TARGET });
    if (error) throw error;
  }
}

class SupabaseActivityRepository implements ActivityRepository {
  constructor(private supabase: SupabaseClient, private workspaceId: string) {}

  async list(limit = 100): Promise<ActivityEvent[]> {
    const { data, error } = await this.supabase
      .from("activity_events")
      .select("*")
      .order("at", { ascending: false })
      .limit(limit);
    if (error) throw error;
    return (data ?? []).map(activityFromRow);
  }

  async add(ev: ActivityEvent): Promise<ActivityEvent> {
    const row = activityToRow({ ...ev, id: idFor(ev.id) }, this.workspaceId);
    const { data, error } = await this.supabase
      .from("activity_events")
      .insert(row)
      .select("*")
      .single();
    if (error) throw error;
    return activityFromRow(data);
  }

  async clear(): Promise<void> {
    const { error } = await this.supabase
      .from("activity_events")
      .delete()
      .eq("workspace_id", this.workspaceId);
    if (error) throw error;
  }

  async bulkPut(events: ActivityEvent[]): Promise<void> {
    if (!events.length) return;
    const rows = events.map((e) => activityToRow({ ...e, id: idFor(e.id) }, this.workspaceId));
    const { error } = await this.supabase.from("activity_events").upsert(rows);
    if (error) throw error;
  }
}

class SupabaseSettingsRepository implements SettingsRepository {
  constructor(private supabase: SupabaseClient, private workspaceId: string) {}

  async get(): Promise<WorkspaceSettings | undefined> {
    const { data, error } = await this.supabase
      .from("workspace_settings")
      .select("*")
      .eq("workspace_id", this.workspaceId)
      .maybeSingle();
    if (error) throw error;
    return data ? settingsFromRow(data) : undefined;
  }

  async put(settings: WorkspaceSettings): Promise<WorkspaceSettings> {
    const row = settingsToRow(settings, this.workspaceId);
    const { data, error } = await this.supabase
      .from("workspace_settings")
      .upsert(row, { onConflict: "workspace_id" })
      .select("*")
      .single();
    if (error) throw error;
    return settingsFromRow(data);
  }
}

class SupabaseWorkspaceService implements WorkspaceService {
  constructor(
    private buyers: BuyerRepository,
    private campaigns: CampaignRepository,
    private recipients: RecipientRepository,
    private templates: TemplateRepository,
    private assets: AssetRepository,
    private activity: ActivityRepository,
    private settings: SettingsRepository,
    private supabase: SupabaseClient,
    private workspaceId: string,
  ) {}

  async exportBackup(): Promise<WorkspaceBackup> {
    const [buyers, campaigns, templates, assets, activity, settings] = await Promise.all([
      this.buyers.list(),
      this.campaigns.list(),
      this.templates.list(),
      this.assets.list(),
      this.activity.list(10000),
      this.settings.get(),
    ]);
    const { data: recipientRows, error } = await this.supabase
      .from("campaign_recipients")
      .select("*");
    if (error) throw error;
    const recipients = (recipientRows ?? []).map(recipientFromRow);
    return {
      version: 1,
      exportedAt: new Date().toISOString(),
      workspace: {
        buyers,
        campaigns,
        templates,
        assets,
        activity,
        recipients,
        settings: settings ?? null,
      },
    };
  }

  async importBackup(): Promise<void> {
    // Cloud-mode restore is not part of Phase 1.5. Users export backups
    // and restore via IT if needed; we deliberately do not accept arbitrary
    // JSON re-imports into a live cloud workspace.
    throw new Error(
      "Cloud workspace restore is disabled. Contact MDF admin to restore from a backup file.",
    );
  }

  async clearDemoData(): Promise<void> {
    // Production has no demo data by construction. This is a no-op in cloud
    // mode; the isDemo discriminator remains in types.ts for future use.
    return;
  }

  async resetAll(): Promise<void> {
    throw new Error(
      "Cloud workspace reset is not exposed in the app. Use Supabase Dashboard for administrative operations.",
    );
  }
}

export interface SupabaseRepositoryBundle {
  buyers: BuyerRepository;
  campaigns: CampaignRepository;
  recipients: RecipientRepository;
  templates: TemplateRepository;
  assets: AssetRepository;
  activity: ActivityRepository;
  settings: SettingsRepository;
  workspace: WorkspaceService;
  buyerCandidates: BuyerCandidateRepository;
  buyerCandidateContacts: BuyerCandidateContactRepository;
  buyerCandidateProductMatches: BuyerCandidateProductMatchRepository;
  buyerFinderSearchRuns: BuyerFinderSearchRunRepository;
}

export function createSupabaseRepositories(
  supabase: SupabaseClient,
  workspaceId: string,
): SupabaseRepositoryBundle {
  const buyers = new SupabaseBuyerRepository(supabase, workspaceId);
  const campaigns = new SupabaseCampaignRepository(supabase, workspaceId);
  const recipients = new SupabaseRecipientRepository(supabase, workspaceId);
  const templates = new SupabaseTemplateRepository(supabase, workspaceId);
  const assets = new SupabaseAssetRepository(supabase, workspaceId);
  const activity = new SupabaseActivityRepository(supabase, workspaceId);
  const settings = new SupabaseSettingsRepository(supabase, workspaceId);
  const buyerCandidates = createBuyerCandidateRepository(supabase, workspaceId);
  const buyerCandidateContacts = createBuyerCandidateContactRepository(supabase, workspaceId);
  const buyerCandidateProductMatches = createBuyerCandidateProductMatchRepository(
    supabase,
    workspaceId,
  );
  const buyerFinderSearchRuns = createBuyerFinderSearchRunRepository(supabase, workspaceId);
  const workspace = new SupabaseWorkspaceService(
    buyers,
    campaigns,
    recipients,
    templates,
    assets,
    activity,
    settings,
    supabase,
    workspaceId,
  );
  return {
    buyers,
    campaigns,
    recipients,
    templates,
    assets,
    activity,
    settings,
    workspace,
    buyerCandidates,
    buyerCandidateContacts,
    buyerCandidateProductMatches,
    buyerFinderSearchRuns,
  };
}
