import type { SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
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
  BuyerRepository,
  CampaignRepository,
  RecipientRepository,
  SettingsRepository,
  TemplateRepository,
  WorkspaceService,
} from "../interfaces";
import {
  activityFromRow,
  activityToRow,
  assetFromRow,
  assetToRow,
  buyerFromRow,
  buyerToRow,
  campaignFromRow,
  campaignToRow,
  recipientFromRow,
  recipientToRow,
  settingsFromRow,
  settingsToRow,
  templateFromRow,
  templateToRow,
} from "./mappers";

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
    const row = buyerToRow({ ...patch, id }, this.workspaceId);
    const { workspace_id: _ws, id: _id, ...updateFields } = row;
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
    const row = campaignToRow({ ...patch, id }, this.workspaceId);
    const { workspace_id: _ws, id: _id, ...updateFields } = row;
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
    const row = recipientToRow({ ...patch, id }, this.workspaceId);
    const { workspace_id: _ws, id: _id, campaign_id: _c, buyer_id: _b, ...fields } = row;
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
    const row = templateToRow({ ...patch, id }, this.workspaceId);
    const { workspace_id: _ws, id: _id, ...updateFields } = row;
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

  async put(a: AssetRecord): Promise<AssetRecord> {
    const row = assetToRow({ ...a, id: idFor(a.id) }, this.workspaceId);
    const { data, error } = await this.supabase
      .from("email_assets")
      .upsert(row, { onConflict: "workspace_id,slot" })
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
      .upsert(rows, { onConflict: "workspace_id,slot" });
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
  return { buyers, campaigns, recipients, templates, assets, activity, settings, workspace };
}
