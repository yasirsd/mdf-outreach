import {
  IndexedDBActivityRepository,
  IndexedDBAssetRepository,
  IndexedDBBuyerRepository,
  IndexedDBCampaignRepository,
  IndexedDBRecipientRepository,
  IndexedDBSettingsRepository,
  IndexedDBTemplateRepository,
  IndexedDBWorkspaceService,
} from "./indexeddb";

export const buyerRepo = new IndexedDBBuyerRepository();
export const campaignRepo = new IndexedDBCampaignRepository();
export const recipientRepo = new IndexedDBRecipientRepository();
export const templateRepo = new IndexedDBTemplateRepository();
export const assetRepo = new IndexedDBAssetRepository();
export const activityRepo = new IndexedDBActivityRepository();
export const settingsRepo = new IndexedDBSettingsRepository();
export const workspaceService = new IndexedDBWorkspaceService(
  buyerRepo,
  campaignRepo,
  recipientRepo,
  templateRepo,
  assetRepo,
  activityRepo,
  settingsRepo,
);

export * from "./interfaces";
