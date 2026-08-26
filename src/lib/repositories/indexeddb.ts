import { getDb } from "@/lib/db/dexie";
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
} from "./interfaces";

export class IndexedDBBuyerRepository implements BuyerRepository {
  async list() {
    return getDb().buyers.orderBy("updatedAt").reverse().toArray();
  }
  async get(id: string) {
    return getDb().buyers.get(id);
  }
  async create(b: Buyer) {
    await getDb().buyers.add(b);
    return b;
  }
  async update(id: string, patch: Partial<Buyer>) {
    await getDb().buyers.update(id, { ...patch, updatedAt: new Date().toISOString() });
    const b = await getDb().buyers.get(id);
    if (!b) throw new Error("Buyer not found");
    return b;
  }
  async delete(id: string) {
    await getDb().buyers.delete(id);
  }
  async bulkPut(buyers: Buyer[]) {
    await getDb().buyers.bulkPut(buyers);
  }
  async findByEmail(email: string) {
    return getDb().buyers.where("email").equalsIgnoreCase(email).first();
  }
}

export class IndexedDBCampaignRepository implements CampaignRepository {
  async list() {
    return getDb().campaigns.orderBy("updatedAt").reverse().toArray();
  }
  async get(id: string) {
    return getDb().campaigns.get(id);
  }
  async create(c: Campaign) {
    await getDb().campaigns.add(c);
    return c;
  }
  async update(id: string, patch: Partial<Campaign>) {
    await getDb().campaigns.update(id, { ...patch, updatedAt: new Date().toISOString() });
    const c = await getDb().campaigns.get(id);
    if (!c) throw new Error("Campaign not found");
    return c;
  }
  async delete(id: string) {
    await getDb().campaigns.delete(id);
    await getDb().recipients.where("campaignId").equals(id).delete();
  }
  async bulkPut(campaigns: Campaign[]) {
    await getDb().campaigns.bulkPut(campaigns);
  }
}

export class IndexedDBRecipientRepository implements RecipientRepository {
  async listByCampaign(campaignId: string) {
    return getDb().recipients.where("campaignId").equals(campaignId).toArray();
  }
  async add(r: CampaignRecipient) {
    await getDb().recipients.put(r);
    return r;
  }
  async update(id: string, patch: Partial<CampaignRecipient>) {
    await getDb().recipients.update(id, patch);
    const r = await getDb().recipients.get(id);
    if (!r) throw new Error("Recipient not found");
    return r;
  }
  async remove(id: string) {
    await getDb().recipients.delete(id);
  }
  async bulkPut(recipients: CampaignRecipient[]) {
    await getDb().recipients.bulkPut(recipients);
  }
  async find(campaignId: string, buyerId: string) {
    return getDb()
      .recipients.where("[campaignId+buyerId]")
      .equals([campaignId, buyerId])
      .first();
  }
}

export class IndexedDBTemplateRepository implements TemplateRepository {
  async list() {
    return getDb().templates.toArray();
  }
  async get(id: string) {
    return getDb().templates.get(id);
  }
  async create(t: EmailTemplate) {
    await getDb().templates.add(t);
    return t;
  }
  async update(id: string, patch: Partial<EmailTemplate>) {
    await getDb().templates.update(id, { ...patch, updatedAt: new Date().toISOString() });
    const t = await getDb().templates.get(id);
    if (!t) throw new Error("Template not found");
    return t;
  }
  async delete(id: string) {
    await getDb().templates.delete(id);
  }
  async bulkPut(templates: EmailTemplate[]) {
    await getDb().templates.bulkPut(templates);
  }
}

export class IndexedDBAssetRepository implements AssetRepository {
  async list() {
    return getDb().assets.toArray();
  }
  async get(id: string) {
    return getDb().assets.get(id);
  }
  async findBySlot(themeKey: string, slot: string) {
    return getDb()
      .assets.filter((a) => a.themeKey === themeKey && a.slot === slot)
      .first();
  }
  async put(a: AssetRecord) {
    await getDb().assets.put(a);
    return a;
  }
  async patch(id: string, patch: Partial<AssetRecord>) {
    await getDb().assets.update(id, { ...patch, updatedAt: new Date().toISOString() });
    const a = await getDb().assets.get(id);
    if (!a) throw new Error("Asset not found");
    return a;
  }
  async delete(id: string) {
    await getDb().assets.delete(id);
  }
  async bulkPut(assets: AssetRecord[]) {
    await getDb().assets.bulkPut(assets);
  }
}

export class IndexedDBActivityRepository implements ActivityRepository {
  async list(limit = 100) {
    return getDb().activity.orderBy("at").reverse().limit(limit).toArray();
  }
  async add(ev: ActivityEvent) {
    await getDb().activity.add(ev);
    return ev;
  }
  async clear() {
    await getDb().activity.clear();
  }
  async bulkPut(events: ActivityEvent[]) {
    await getDb().activity.bulkPut(events);
  }
}

export class IndexedDBSettingsRepository implements SettingsRepository {
  async get() {
    return getDb().settings.get("singleton");
  }
  async put(settings: WorkspaceSettings) {
    await getDb().settings.put({ ...settings, id: "singleton" });
    return settings;
  }
}

export class IndexedDBWorkspaceService implements WorkspaceService {
  constructor(
    private buyers = new IndexedDBBuyerRepository(),
    private campaigns = new IndexedDBCampaignRepository(),
    private recipients = new IndexedDBRecipientRepository(),
    private templates = new IndexedDBTemplateRepository(),
    private assets = new IndexedDBAssetRepository(),
    private activity = new IndexedDBActivityRepository(),
    private settings = new IndexedDBSettingsRepository(),
  ) {}

  async exportBackup(): Promise<WorkspaceBackup> {
    const [buyers, campaigns, templates, assets, activity, settings] =
      await Promise.all([
        this.buyers.list(),
        this.campaigns.list(),
        this.templates.list(),
        this.assets.list(),
        this.activity.list(10000),
        this.settings.get(),
      ]);
    const recipientRows = await getDb().recipients.toArray();
    return {
      version: 1,
      exportedAt: new Date().toISOString(),
      workspace: {
        buyers,
        campaigns,
        templates,
        assets,
        activity,
        recipients: recipientRows,
        settings: settings ?? null,
      },
    };
  }

  async importBackup(backup: WorkspaceBackup, mode: "replace" | "merge") {
    if (backup.version !== 1) {
      throw new Error(`Unsupported backup version: ${backup.version}`);
    }
    const db = getDb();
    await db.transaction(
      "rw",
      [db.buyers, db.campaigns, db.recipients, db.templates, db.assets, db.activity, db.settings],
      async () => {
        if (mode === "replace") {
          await db.buyers.clear();
          await db.campaigns.clear();
          await db.recipients.clear();
          await db.templates.clear();
          await db.assets.clear();
          await db.activity.clear();
          await db.settings.clear();
        }
        const ws = backup.workspace;
        if (ws.buyers?.length) await db.buyers.bulkPut(ws.buyers);
        if (ws.campaigns?.length) await db.campaigns.bulkPut(ws.campaigns);
        if (ws.recipients?.length) await db.recipients.bulkPut(ws.recipients);
        if (ws.templates?.length) await db.templates.bulkPut(ws.templates);
        if (ws.assets?.length) await db.assets.bulkPut(ws.assets);
        if (ws.activity?.length) await db.activity.bulkPut(ws.activity);
        if (ws.settings) await db.settings.put({ ...ws.settings, id: "singleton" });
      },
    );
  }

  async clearDemoData() {
    const db = getDb();
    await db.transaction(
      "rw",
      db.buyers,
      db.campaigns,
      db.recipients,
      db.templates,
      async () => {
        const demoBuyers = await db.buyers.filter((b) => !!b.isDemo).toArray();
        const demoCampaigns = await db.campaigns.filter((c) => !!c.isDemo).toArray();
        const demoTemplates = await db.templates.filter((t) => !!t.isDemo).toArray();
        await db.buyers.bulkDelete(demoBuyers.map((b) => b.id));
        for (const c of demoCampaigns) {
          await db.recipients.where("campaignId").equals(c.id).delete();
        }
        await db.campaigns.bulkDelete(demoCampaigns.map((c) => c.id));
        await db.templates.bulkDelete(demoTemplates.map((t) => t.id));
      },
    );
  }

  async resetAll() {
    const db = getDb();
    await Promise.all([
      db.buyers.clear(),
      db.campaigns.clear(),
      db.recipients.clear(),
      db.templates.clear(),
      db.assets.clear(),
      db.activity.clear(),
      db.settings.clear(),
    ]);
  }
}
