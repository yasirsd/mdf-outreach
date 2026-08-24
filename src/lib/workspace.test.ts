import { describe, it, expect, beforeEach } from "vitest";
import {
  IndexedDBBuyerRepository,
  IndexedDBCampaignRepository,
  IndexedDBRecipientRepository,
  IndexedDBTemplateRepository,
  IndexedDBAssetRepository,
  IndexedDBActivityRepository,
  IndexedDBSettingsRepository,
  IndexedDBWorkspaceService,
} from "@/lib/repositories/indexeddb";
import { buildDemoWorkspace } from "@/test/fixtures/demo";
import { getDb } from "@/lib/db/dexie";

const buyers = new IndexedDBBuyerRepository();
const campaigns = new IndexedDBCampaignRepository();
const recipients = new IndexedDBRecipientRepository();
const templates = new IndexedDBTemplateRepository();
const assets = new IndexedDBAssetRepository();
const activity = new IndexedDBActivityRepository();
const settings = new IndexedDBSettingsRepository();
const service = new IndexedDBWorkspaceService(buyers, campaigns, recipients, templates, assets, activity, settings);

async function clearAll() {
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

describe("workspace backup/import", () => {
  beforeEach(async () => {
    await clearAll();
  });

  it("exports and reimports workspace with all entities", async () => {
    const demo = buildDemoWorkspace();
    await buyers.bulkPut(demo.buyers);
    await campaigns.bulkPut([demo.campaign]);
    await recipients.bulkPut(demo.recipients);
    await templates.bulkPut([demo.template]);
    await assets.bulkPut(demo.assets);
    await activity.bulkPut(demo.activity);
    await settings.put(demo.settings);

    const backup = await service.exportBackup();
    expect(backup.version).toBe(1);
    expect(backup.workspace.buyers.length).toBe(demo.buyers.length);
    expect(backup.workspace.recipients.length).toBe(demo.recipients.length);

    await clearAll();
    expect(await buyers.list()).toHaveLength(0);

    await service.importBackup(backup, "replace");
    expect(await buyers.list()).toHaveLength(demo.buyers.length);
    expect(await campaigns.list()).toHaveLength(1);
    expect((await settings.get())?.company.companyName).toBe(demo.settings.company.companyName);
  });

  it("finds buyer by email (case-insensitive)", async () => {
    const now = new Date().toISOString();
    await buyers.create({
      id: "b1",
      firstName: "A",
      lastName: "B",
      company: "X",
      email: "somebody@example.com",
      country: "Thailand",
      status: "new",
      createdAt: now,
      updatedAt: now,
    });
    const found = await buyers.findByEmail("SOMEBODY@example.com");
    expect(found?.id).toBe("b1");
  });
});
