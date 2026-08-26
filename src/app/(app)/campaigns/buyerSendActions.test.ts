import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import type {
  AssetRecord,
  Buyer,
  Campaign,
  CampaignRecipient,
  EmailTemplate,
  WorkspaceSettings,
} from "@/lib/types";

/**
 * End-to-end coverage for sendBuyersAction (production Buyer Send).
 *
 * Every dependency that touches the network, Supabase, cookies, Gmail,
 * or the auth layer is mocked in-process. Assertions target the invariants
 * called out in the Phase E requirements:
 *
 *   • suppression enforced server-side
 *   • invalid emails refused
 *   • buyers outside the campaign refused
 *   • already-sent buyers not re-delivered
 *   • server-side batch limit
 *   • sequential loop, one Gmail call per buyer
 *   • advanced buyer status never downgraded
 *   • BUYER_SEND_ENABLED=false blocks Gmail even after all preflight passes
 *   • buyer.email is loaded from DB, not from client
 *   • master template is never mutated
 *   • per-buyer claim + partial unique index prevent duplicate delivery
 */

// -----------------------------------------------------------------------
// Env — default OFF; individual tests may flip on.
// -----------------------------------------------------------------------
delete process.env.BUYER_SEND_ENABLED;

// -----------------------------------------------------------------------
// Auth / repository state
// -----------------------------------------------------------------------
const SESSION = {
  userId: "user-a",
  membership: { workspaceId: "ws-a" },
};

function makeBuyer(over: Partial<Buyer> = {}): Buyer {
  return {
    id: "b1",
    firstName: "John",
    lastName: "Tan",
    company: "ABC Foods",
    email: "john@abcfoods.example",
    country: "Thailand",
    status: "new",
    createdAt: "2026-08-25T00:00:00Z",
    updatedAt: "2026-08-25T00:00:00Z",
    ...over,
  };
}

const CAMPAIGN: Campaign = {
  id: "c1",
  name: "Thailand — Guntur",
  country: "Thailand",
  product: "Guntur Dry Red Chilli",
  templateId: "t1",
  status: "draft",
  subject: "Guntur — Thai importers",
  preheader: "",
  fromName: "MDF Exports & Imports",
  replyTo: "contact@mdfexport.com",
  themeKey: "guntur-chilli",
  templateVariant: "signature",
  emailSections: [],
  createdAt: "2026-08-25T00:00:00Z",
  updatedAt: "2026-08-25T00:00:00Z",
};

const TEMPLATE: EmailTemplate = {
  id: "t1",
  name: "MDF Master",
  sections: [],
  themeKey: "guntur-chilli",
  variant: "signature",
  version: 1,
  status: "approved",
  createdAt: "2026-08-25T00:00:00Z",
  updatedAt: "2026-08-25T00:00:00Z",
};

const HERO: AssetRecord = {
  id: "a1",
  themeKey: "guntur-chilli",
  slot: "hero",
  name: "hero.jpg",
  productionUrl: "https://cdn.example/hero.jpg",
  storagePath: "ws/guntur-chilli/hero/hero.jpg",
  status: "production",
  altText: "Guntur hero",
  isDecorative: false,
  updatedAt: "2026-08-25T00:00:00Z",
};

const SETTINGS: WorkspaceSettings = {
  id: "singleton",
  company: {
    companyName: "MDF Exports & Imports",
    shortName: "MDF",
    tagline: "",
    heritage: "",
    location: "",
    website: "",
    email: "",
  },
  brand: { orange: "", charcoal: "", ivory: "", chilli: "" },
  email: {
    fromName: "MDF",
    replyTo: "contact@mdfexport.com",
    websiteUrl: "",
    whatsappUrl: "",
    linkedinUrl: "",
    instagramUrl: "",
    defaultCtaUrl: "",
    defaultSubject: "",
    defaultPreheader: "",
  },
  onboardingComplete: true,
  createdAt: "x",
  updatedAt: "x",
};

// -----------------------------------------------------------------------
// Mutable in-memory state the mocks operate on. Reset in beforeEach.
// -----------------------------------------------------------------------
interface Recip extends CampaignRecipient {
  workspaceId: string;
}

const state: {
  buyers: Map<string, Buyer>;
  recipients: Recip[];
  templates: Map<string, EmailTemplate>;
  campaigns: Map<string, Campaign>;
  assets: AssetRecord[];
  events: Array<{
    workspace_id: string;
    campaign_id: string;
    buyer_id: string;
    kind: string;
    ok: boolean;
    error: string | null;
    gmail_message_id: string | null;
    subject: string;
    recipient_email: string;
  }>;
  idempotency: Set<string>; // "ws:nonce"
  buyerUpdateCalls: Array<{ id: string; patch: Partial<Buyer> }>;
  recipientUpdateCalls: Array<{ id: string; patch: Partial<CampaignRecipient> }>;
  templateUpdateCalls: Array<{ id: string; patch: Partial<EmailTemplate> }>;
  gmailCalls: Array<{ to: string; subject: string }>;
  gmailNextResult: "ok" | "error";
} = {
  buyers: new Map(),
  recipients: [],
  templates: new Map(),
  campaigns: new Map(),
  assets: [],
  events: [],
  idempotency: new Set(),
  buyerUpdateCalls: [],
  recipientUpdateCalls: [],
  templateUpdateCalls: [],
  gmailCalls: [],
  gmailNextResult: "ok",
};

// -----------------------------------------------------------------------
// Mocks
// -----------------------------------------------------------------------
vi.mock("next/headers", () => ({ cookies: () => ({}) }));

// A fake SupabaseClient that supports the narrow set of queries this
// action performs. We rewire per-table behavior manually.
type Row = Record<string, unknown>;
function makeSupabase() {
  return {
    from(table: string) {
      return {
        insert(row: Row) {
          if (table === "email_send_events") {
            const r = row as Row;
            // Simulate the partial-unique-index invariant.
            if (
              r.kind === "buyer-send" &&
              r.ok === true &&
              state.events.some(
                (e) =>
                  e.workspace_id === r.workspace_id &&
                  e.campaign_id === r.campaign_id &&
                  e.buyer_id === r.buyer_id &&
                  e.kind === "buyer-send" &&
                  e.ok === true,
              )
            ) {
              return Promise.resolve({
                error: { code: "23505", message: "duplicate key" },
              });
            }
            state.events.push({
              workspace_id: r.workspace_id as string,
              campaign_id: r.campaign_id as string,
              buyer_id: r.buyer_id as string,
              kind: r.kind as string,
              ok: r.ok as boolean,
              error: (r.error as string | null) ?? null,
              gmail_message_id: (r.gmail_message_id as string | null) ?? null,
              subject: r.subject as string,
              recipient_email: r.recipient_email as string,
            });
            return Promise.resolve({ error: null });
          }
          if (table === "email_send_idempotency") {
            const r = row as Row;
            const key = `${r.workspace_id}:${r.nonce}`;
            if (state.idempotency.has(key)) {
              return Promise.resolve({
                error: { code: "23505", message: "duplicate key" },
              });
            }
            state.idempotency.add(key);
            return Promise.resolve({ error: null });
          }
          throw new Error(`unmocked insert into ${table}`);
        },
        select() {
          const self = this;
          const filters: Array<[string, unknown]> = [];
          const inFilters: Array<[string, unknown[]]> = [];
          const builder: {
            eq(col: string, val: unknown): typeof builder;
            in(col: string, vals: unknown[]): typeof builder;
            then(cb: (res: { data: unknown; error: unknown }) => unknown): unknown;
          } = {
            eq(col, val) {
              filters.push([col, val]);
              return builder;
            },
            in(col, vals) {
              inFilters.push([col, vals]);
              return builder;
            },
            then(cb) {
              let rows: unknown[] = [];
              if (table === "email_send_events") {
                rows = state.events.filter((e) => {
                  for (const [c, v] of filters) {
                    if ((e as Record<string, unknown>)[c] !== v) return false;
                  }
                  for (const [c, vs] of inFilters) {
                    if (!vs.includes((e as Record<string, unknown>)[c])) return false;
                  }
                  return true;
                });
              }
              return Promise.resolve(
                cb({ data: rows.map((r) => ({ buyer_id: (r as Row).buyer_id })), error: null }),
              );
            },
          };
          void self;
          return builder;
        },
        delete() {
          const filters: Array<[string, unknown]> = [];
          const builder = {
            eq(col: string, val: unknown) {
              filters.push([col, val]);
              return builder;
            },
            then(cb: (res: { error: unknown }) => unknown) {
              if (table === "email_send_idempotency") {
                const ws = filters.find(([c]) => c === "workspace_id")?.[1] as string;
                const nonce = filters.find(([c]) => c === "nonce")?.[1] as string;
                state.idempotency.delete(`${ws}:${nonce}`);
              }
              return Promise.resolve(cb({ error: null }));
            },
          };
          return builder;
        },
      };
    },
  };
}

vi.mock("@/utils/supabase/server", () => ({
  createClient: () => makeSupabase(),
}));

vi.mock("@/lib/gmail/tokens", () => ({
  loadGmailConnection: async () => ({
    workspaceId: "ws-a",
    googleUserEmail: "contact@mdfexport.com",
    accessToken: "at",
    refreshToken: "rt",
    scope: "https://www.googleapis.com/auth/gmail.send",
    expiryAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  }),
  ensureFreshAccessToken: async () => "at",
}));

vi.mock("@/lib/gmail/sendClient", () => ({
  GmailApiError: class GmailApiError extends Error {
    status = 500;
    detail = "";
    constructor(msg: string) {
      super(msg);
    }
  },
  sendGmailMessage: vi.fn(async (_at: string, input: { to: string; subject: string }) => {
    state.gmailCalls.push({ to: input.to, subject: input.subject });
    if (state.gmailNextResult === "error") {
      throw new Error("Gmail rejected");
    }
    return {
      messageId: `mid-${state.gmailCalls.length}`,
      threadId: `tid-${state.gmailCalls.length}`,
    };
  }),
}));

vi.mock("@/lib/activity", () => ({ logActivity: async () => undefined }));

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

// serverRepositories — supply session + repos backed by the state maps.
vi.mock("@/lib/repositories/server", () => ({
  serverRepositories: async () => ({
    session: SESSION,
    repos: {
      buyers: {
        list: async () => Array.from(state.buyers.values()),
        get: async (id: string) => state.buyers.get(id),
        update: async (id: string, patch: Partial<Buyer>) => {
          state.buyerUpdateCalls.push({ id, patch });
          const cur = state.buyers.get(id);
          const next = { ...(cur ?? ({} as Buyer)), ...patch, id } as Buyer;
          state.buyers.set(id, next);
          return next;
        },
      },
      campaigns: {
        get: async (id: string) => state.campaigns.get(id),
      },
      templates: {
        get: async (id: string) => state.templates.get(id),
        update: async (id: string, patch: Partial<EmailTemplate>) => {
          state.templateUpdateCalls.push({ id, patch });
          const cur = state.templates.get(id);
          const next = { ...(cur ?? ({} as EmailTemplate)), ...patch, id } as EmailTemplate;
          state.templates.set(id, next);
          return next;
        },
      },
      recipients: {
        listByCampaign: async (cid: string) =>
          state.recipients.filter((r) => r.campaignId === cid),
        update: async (id: string, patch: Partial<CampaignRecipient>) => {
          state.recipientUpdateCalls.push({ id, patch });
          const cur = state.recipients.find((r) => r.id === id);
          if (cur) Object.assign(cur, patch);
          return cur as CampaignRecipient;
        },
      },
      assets: {
        list: async () => state.assets,
      },
      settings: {
        get: async () => SETTINGS,
      },
    },
  }),
}));

// Import AFTER all mocks are set up.
const { sendBuyersAction } = await import("./buyerSendActions");
const { BUYER_SEND_BATCH_MAX } = await import("@/lib/gmail/buyerSendConfig");

// -----------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------
function resetState() {
  state.buyers.clear();
  state.recipients = [];
  state.templates.clear();
  state.campaigns.clear();
  state.assets = [HERO];
  state.events = [];
  state.idempotency.clear();
  state.buyerUpdateCalls = [];
  state.recipientUpdateCalls = [];
  state.templateUpdateCalls = [];
  state.gmailCalls = [];
  state.gmailNextResult = "ok";
  state.campaigns.set(CAMPAIGN.id, { ...CAMPAIGN });
  state.templates.set(TEMPLATE.id, { ...TEMPLATE });
}

function addBuyer(over: Partial<Buyer> = {}) {
  const b = makeBuyer(over);
  state.buyers.set(b.id, b);
  state.recipients.push({
    id: `r-${b.id}`,
    workspaceId: SESSION.membership.workspaceId,
    campaignId: CAMPAIGN.id,
    buyerId: b.id,
    status: "ready",
    createdAt: "2026-08-25T00:00:00Z",
  });
  return b;
}

beforeEach(() => {
  resetState();
});
afterEach(() => {
  delete process.env.BUYER_SEND_ENABLED;
});

// -----------------------------------------------------------------------
// Tests
// -----------------------------------------------------------------------

describe("sendBuyersAction — safety gate", () => {
  it("BUYER_SEND_ENABLED=false: refuses the Gmail call even after preflight passes", async () => {
    addBuyer();
    const res = await sendBuyersAction({
      campaignId: CAMPAIGN.id,
      buyerIds: ["b1"],
      batchNonce: "n1",
    });
    expect(state.gmailCalls.length).toBe(0);
    expect(res.sent).toBe(0);
    expect(res.outcomes[0].ok).toBe(false);
    expect(res.outcomes[0].ok === false && res.outcomes[0].error).toMatch(
      /BUYER_SEND_ENABLED|not enabled/i,
    );
    // Audit row for the refusal must exist so operators see a trail.
    expect(state.events.length).toBe(1);
    expect(state.events[0].ok).toBe(false);
  });
});

describe("sendBuyersAction — batch limit", () => {
  it("rejects batches larger than BUYER_SEND_BATCH_MAX server-side", async () => {
    process.env.BUYER_SEND_ENABLED = "true";
    for (let i = 0; i < BUYER_SEND_BATCH_MAX + 1; i++) {
      addBuyer({ id: `b${i}`, email: `x${i}@example.com` });
    }
    const res = await sendBuyersAction({
      campaignId: CAMPAIGN.id,
      buyerIds: Array.from({ length: BUYER_SEND_BATCH_MAX + 1 }, (_, i) => `b${i}`),
      batchNonce: "n1",
    });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/safety limit/i);
    expect(state.gmailCalls.length).toBe(0);
  });
});

describe("sendBuyersAction — happy path", () => {
  beforeEach(() => {
    process.env.BUYER_SEND_ENABLED = "true";
  });

  it("sends one Gmail message per eligible buyer to the buyer's DB email (never the client email)", async () => {
    addBuyer({ id: "b1", email: "one@example.com" });
    addBuyer({ id: "b2", email: "two@example.com" });
    const res = await sendBuyersAction({
      campaignId: CAMPAIGN.id,
      buyerIds: ["b1", "b2"],
      batchNonce: "n1",
    });
    expect(res.sent).toBe(2);
    expect(state.gmailCalls.map((c) => c.to).sort()).toEqual([
      "one@example.com",
      "two@example.com",
    ]);
    // One audit success row per buyer.
    const successRows = state.events.filter((e) => e.ok);
    expect(successRows.length).toBe(2);
    // Recipient marked contacted.
    expect(state.recipientUpdateCalls.length).toBe(2);
    // Buyer promoted new -> contacted.
    const promoted = state.buyerUpdateCalls.filter((c) => c.patch.status === "contacted");
    expect(promoted.length).toBe(2);
    // Master template NOT mutated.
    expect(state.templateUpdateCalls.length).toBe(0);
  });

  it("advanced buyer status (interested / converted) is NEVER downgraded, only last_contacted_at is updated", async () => {
    addBuyer({ id: "b-adv", email: "adv@example.com", status: "interested" });
    await sendBuyersAction({
      campaignId: CAMPAIGN.id,
      buyerIds: ["b-adv"],
      batchNonce: "n1",
    });
    const advCall = state.buyerUpdateCalls.find((c) => c.id === "b-adv");
    expect(advCall).toBeTruthy();
    expect(advCall!.patch.status).toBeUndefined(); // never overwritten
    expect(advCall!.patch.lastContactedAt).toBeTruthy();
  });
});

describe("sendBuyersAction — refusals", () => {
  beforeEach(() => {
    process.env.BUYER_SEND_ENABLED = "true";
  });

  it("suppressed buyer is refused server-side, Gmail never called", async () => {
    addBuyer({ suppressed: true, suppressionReason: "manual" });
    const res = await sendBuyersAction({
      campaignId: CAMPAIGN.id,
      buyerIds: ["b1"],
      batchNonce: "n1",
    });
    expect(state.gmailCalls.length).toBe(0);
    expect(res.outcomes[0].ok).toBe(false);
    expect(res.outcomes[0].ok === false && res.outcomes[0].error).toMatch(/Do not contact/i);
  });

  it("invalid buyer email is refused server-side", async () => {
    addBuyer({ email: "not-an-email" });
    const res = await sendBuyersAction({
      campaignId: CAMPAIGN.id,
      buyerIds: ["b1"],
      batchNonce: "n1",
    });
    expect(state.gmailCalls.length).toBe(0);
    expect(res.outcomes[0].ok === false && res.outcomes[0].error).toMatch(/valid email/i);
  });

  it("buyer outside the campaign is refused (recipient row not found)", async () => {
    // Buyer exists in workspace but no campaign_recipient row.
    state.buyers.set("b-stray", makeBuyer({ id: "b-stray", email: "s@example.com" }));
    const res = await sendBuyersAction({
      campaignId: CAMPAIGN.id,
      buyerIds: ["b-stray"],
      batchNonce: "n1",
    });
    expect(state.gmailCalls.length).toBe(0);
    expect(res.outcomes[0].ok === false && res.outcomes[0].error).toMatch(/not part of/i);
  });

  it("already-successfully-sent buyer cannot be sent again in a subsequent batch", async () => {
    addBuyer();
    // First batch — succeeds and writes ok=true event.
    await sendBuyersAction({
      campaignId: CAMPAIGN.id,
      buyerIds: ["b1"],
      batchNonce: "n1",
    });
    expect(state.gmailCalls.length).toBe(1);
    // Second batch — must NOT re-deliver.
    const res2 = await sendBuyersAction({
      campaignId: CAMPAIGN.id,
      buyerIds: ["b1"],
      batchNonce: "n2",
    });
    expect(state.gmailCalls.length).toBe(1); // no additional call
    expect(res2.outcomes[0].ok).toBe(false);
    expect(res2.outcomes[0].ok === false && res2.outcomes[0].skipped).toBe("already-sent");
  });

  it("duplicate batch nonce is rejected before any Gmail call", async () => {
    addBuyer();
    const res1 = await sendBuyersAction({
      campaignId: CAMPAIGN.id,
      buyerIds: ["b1"],
      batchNonce: "same",
    });
    expect(res1.sent).toBe(1);
    const gmailAfterFirst = state.gmailCalls.length;
    // Resubmit the SAME nonce — server must refuse without hitting Gmail.
    const res2 = await sendBuyersAction({
      campaignId: CAMPAIGN.id,
      buyerIds: ["b1"],
      batchNonce: "same",
    });
    expect(res2.ok).toBe(false);
    expect(res2.error).toMatch(/already submitted/i);
    expect(state.gmailCalls.length).toBe(gmailAfterFirst);
  });

  it("empty subject blocks send", async () => {
    state.campaigns.set(CAMPAIGN.id, { ...CAMPAIGN, subject: "" });
    addBuyer();
    const res = await sendBuyersAction({
      campaignId: CAMPAIGN.id,
      buyerIds: ["b1"],
      batchNonce: "n1",
    });
    expect(state.gmailCalls.length).toBe(0);
    expect(res.outcomes[0].ok).toBe(false);
  });

  it("Gmail failure records an ok=false audit row and does NOT mark buyer contacted", async () => {
    addBuyer();
    state.gmailNextResult = "error";
    const res = await sendBuyersAction({
      campaignId: CAMPAIGN.id,
      buyerIds: ["b1"],
      batchNonce: "n1",
    });
    expect(res.failed).toBe(1);
    expect(state.events.length).toBe(1);
    expect(state.events[0].ok).toBe(false);
    // Buyer status must remain "new" (no status patch, no last_contacted_at).
    const statusPatches = state.buyerUpdateCalls.filter((c) => c.patch.status);
    expect(statusPatches.length).toBe(0);
    // Recipient not marked contacted.
    expect(state.recipientUpdateCalls.length).toBe(0);
  });
});

describe("sendBuyersAction — server ignores untrusted client input", () => {
  beforeEach(() => {
    process.env.BUYER_SEND_ENABLED = "true";
  });

  it("recipient email is loaded from buyer row, not from client payload", async () => {
    // The action interface intentionally does not accept a client email —
    // this test proves the type contract holds by asserting Gmail is
    // called with the DB email.
    addBuyer({ email: "authoritative@example.com" });
    await sendBuyersAction({
      campaignId: CAMPAIGN.id,
      buyerIds: ["b1"],
      batchNonce: "n1",
    });
    expect(state.gmailCalls[0].to).toBe("authoritative@example.com");
  });

  it("empty buyerIds array is refused", async () => {
    const res = await sendBuyersAction({
      campaignId: CAMPAIGN.id,
      buyerIds: [],
      batchNonce: "n1",
    });
    expect(res.ok).toBe(false);
    expect(state.gmailCalls.length).toBe(0);
  });
});
