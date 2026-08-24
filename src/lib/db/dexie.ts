import Dexie, { type Table } from "dexie";
import type {
  ActivityEvent,
  AssetRecord,
  Buyer,
  Campaign,
  CampaignRecipient,
  EmailTemplate,
  WorkspaceSettings,
} from "@/lib/types";

export class MDFDatabase extends Dexie {
  buyers!: Table<Buyer, string>;
  campaigns!: Table<Campaign, string>;
  recipients!: Table<CampaignRecipient, string>;
  templates!: Table<EmailTemplate, string>;
  assets!: Table<AssetRecord, string>;
  activity!: Table<ActivityEvent, string>;
  settings!: Table<WorkspaceSettings, string>;

  constructor() {
    super("mdf-outreach");
    this.version(1).stores({
      buyers: "id, email, company, country, status, updatedAt",
      campaigns: "id, status, country, updatedAt",
      recipients: "id, campaignId, buyerId, [campaignId+buyerId]",
      templates: "id, name",
      assets: "id, slot",
      activity: "id, at",
      settings: "id",
    });
  }
}

let _db: MDFDatabase | null = null;

export function getDb(): MDFDatabase {
  if (!_db) {
    _db = new MDFDatabase();
  }
  return _db;
}
