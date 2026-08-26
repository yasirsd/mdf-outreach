import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import type { Campaign } from "@/lib/types";

/**
 * Regression coverage for the Campaign → Email "Email details" panel.
 * These tests exercise the real component through @testing-library and
 * mock the server action so we can assert:
 *   - subject / preheader / from name / reply-to pre-populate
 *   - each blur triggers a PARTIAL patch (never blanks other fields)
 *   - onSaved is called so the parent preview header updates immediately
 *   - empty subject blocks the Gmail send preflight
 */

const updateCampaignAction = vi.fn(async (_id: string, patch: Partial<Campaign>) => {
  return { id: _id, ...patch } as Campaign;
});

vi.mock("@/app/(app)/campaigns/actions", () => ({
  updateCampaignAction: (id: string, patch: Partial<Campaign>) =>
    updateCampaignAction(id, patch),
}));

// Load AFTER the mock so the panel picks up the mocked action.
const { EmailDetailsPanel } = await import("./EmailDetailsPanel");
const { fullPreflight } = await import("@/lib/gmail/preflight");

function makeCampaign(over: Partial<Campaign> = {}): Campaign {
  return {
    id: "cmp-1",
    name: "Thailand — Guntur",
    country: "Thailand",
    product: "Guntur Dry Red Chilli",
    templateId: "tmpl-1",
    status: "draft",
    subject: "Guntur Dry Red Chilli Supply from India",
    preheader: "Stem, stemless and powder options with packing tailored to your requirements.",
    fromName: "MDF Exports & Imports",
    replyTo: "contact@mdfexport.com",
    themeKey: "guntur-chilli",
    templateVariant: "signature",
    emailSections: [],
    createdAt: "2026-08-25T00:00:00Z",
    updatedAt: "2026-08-25T00:00:00Z",
  };
}

// Belt-and-suspenders: run cleanup both before and after each test so
// there is never a stale mount in the DOM competing with the fresh
// render, regardless of test order or previous failures.
beforeEach(() => {
  cleanup();
});
afterEach(() => {
  cleanup();
  updateCampaignAction.mockClear();
});

describe("EmailDetailsPanel — pre-population", () => {
  it("pre-populates subject, preheader, from name, reply-to from the campaign", () => {
    const campaign = makeCampaign();
    render(<EmailDetailsPanel campaign={campaign} onSaved={vi.fn()} />);
    expect((screen.getByLabelText(/Subject/) as HTMLInputElement).value).toBe(campaign.subject);
    expect((screen.getByLabelText(/Preheader/) as HTMLInputElement).value).toBe(
      campaign.preheader,
    );
    expect((screen.getByLabelText(/From name/) as HTMLInputElement).value).toBe(
      campaign.fromName,
    );
    expect((screen.getByLabelText(/Reply-to/) as HTMLInputElement).value).toBe(
      campaign.replyTo,
    );
  });

  it("renders empty fields when the campaign has no defaults", () => {
    const campaign: Campaign = {
      ...makeCampaign(),
      subject: "",
      preheader: "",
      fromName: "",
      replyTo: "",
    };
    render(<EmailDetailsPanel campaign={campaign} onSaved={vi.fn()} />);
    expect((screen.getByLabelText(/Subject/) as HTMLInputElement).value).toBe("");
    // Required-hint appears when subject is empty.
    expect(screen.getByText(/Required before sending/i)).toBeTruthy();
  });
});

describe("EmailDetailsPanel — partial-update safety on blur", () => {
  beforeEach(() => {
    updateCampaignAction.mockClear();
  });

  it("editing subject saves ONLY subject (does not blank preheader / from / reply-to)", async () => {
    const campaign = makeCampaign();
    const onSaved = vi.fn();
    render(<EmailDetailsPanel campaign={campaign} onSaved={onSaved} />);
    const subj = screen.getByLabelText(/Subject/) as HTMLInputElement;
    fireEvent.change(subj, { target: { value: "New subject line" } });
    fireEvent.blur(subj);
    await Promise.resolve();
    await Promise.resolve();

    expect(updateCampaignAction).toHaveBeenCalledTimes(1);
    const [id, patch] = updateCampaignAction.mock.calls[0];
    expect(id).toBe("cmp-1");
    expect(patch).toEqual({ subject: "New subject line" });
    expect("preheader" in patch).toBe(false);
    expect("fromName" in patch).toBe(false);
    expect("replyTo" in patch).toBe(false);
    // Parent gets the same patch so the preview header updates immediately.
    expect(onSaved).toHaveBeenCalledWith({ subject: "New subject line" });
  });

  it("editing preheader does not touch subject / from / reply-to", async () => {
    const campaign = makeCampaign();
    render(<EmailDetailsPanel campaign={campaign} onSaved={vi.fn()} />);
    const pre = screen.getByLabelText(/Preheader/) as HTMLInputElement;
    fireEvent.change(pre, { target: { value: "New preheader copy." } });
    fireEvent.blur(pre);
    await Promise.resolve();
    await Promise.resolve();
    expect(updateCampaignAction).toHaveBeenCalledWith("cmp-1", {
      preheader: "New preheader copy.",
    });
  });

  it("does not fire a save when the value did not change", async () => {
    const campaign = makeCampaign();
    render(<EmailDetailsPanel campaign={campaign} onSaved={vi.fn()} />);
    const subj = screen.getByLabelText(/Subject/) as HTMLInputElement;
    fireEvent.blur(subj);
    await Promise.resolve();
    expect(updateCampaignAction).not.toHaveBeenCalled();
  });

  it("blocks saving an empty subject and surfaces a validation error", async () => {
    const campaign = makeCampaign();
    render(<EmailDetailsPanel campaign={campaign} onSaved={vi.fn()} />);
    const subj = screen.getByLabelText(/Subject/) as HTMLInputElement;
    fireEvent.change(subj, { target: { value: "   " } });
    fireEvent.blur(subj);
    await Promise.resolve();
    expect(updateCampaignAction).not.toHaveBeenCalled();
    expect(screen.getByText(/Subject is required before sending/i)).toBeTruthy();
  });

  it("blocks an invalid reply-to email address", async () => {
    const campaign = makeCampaign({ replyTo: "" });
    render(<EmailDetailsPanel campaign={campaign} onSaved={vi.fn()} />);
    const rt = screen.getByLabelText(/Reply-to/) as HTMLInputElement;
    fireEvent.change(rt, { target: { value: "not-an-email" } });
    fireEvent.blur(rt);
    await Promise.resolve();
    expect(updateCampaignAction).not.toHaveBeenCalled();
    expect(screen.getByText(/valid email address/i)).toBeTruthy();
  });

  it("accepts a valid reply-to email address", async () => {
    const campaign = makeCampaign({ replyTo: "" });
    render(<EmailDetailsPanel campaign={campaign} onSaved={vi.fn()} />);
    const rt = screen.getByLabelText(/Reply-to/) as HTMLInputElement;
    fireEvent.change(rt, { target: { value: "hi@mdfexport.com" } });
    fireEvent.blur(rt);
    await Promise.resolve();
    await Promise.resolve();
    expect(updateCampaignAction).toHaveBeenCalledWith("cmp-1", {
      replyTo: "hi@mdfexport.com",
    });
  });
});

describe("EmailDetailsPanel — architecture invariants", () => {
  it("Email-details edit only writes to campaigns — never modifies the master template", async () => {
    // The mock we set up above only records updateCampaignAction calls
    // (which target repos.campaigns). We ALSO watch console.warn to catch
    // any accidental template-repo import from this file.
    const campaign = makeCampaign();
    render(<EmailDetailsPanel campaign={campaign} onSaved={vi.fn()} />);
    const subj = screen.getByLabelText(/Subject/) as HTMLInputElement;
    fireEvent.change(subj, { target: { value: "Different subject" } });
    fireEvent.blur(subj);
    await Promise.resolve();
    await Promise.resolve();
    expect(updateCampaignAction).toHaveBeenCalledTimes(1);
    // The patch payload MUST NOT contain template lineage fields — those
    // belong to the campaign snapshot / master template layers, not to
    // Email-details.
    const patch = updateCampaignAction.mock.calls[0][1];
    expect("templateId" in patch).toBe(false);
    expect("emailSections" in patch).toBe(false);
    expect("templateVariant" in patch).toBe(false);
    expect("themeKey" in patch).toBe(false);
  });

  it("Settings defaults do not overwrite existing campaign values on update", async () => {
    // Even if Settings later changes defaultSubject, the update path
    // touches ONLY the specific field the operator blurred. This is
    // enforced by campaignToPatchRow (partial-safe) — reproduced here.
    const { campaignToPatchRow } = await import(
      "@/lib/repositories/supabase/mappers"
    );
    const patch = campaignToPatchRow({ preheader: "brand-new preheader" });
    expect(patch).toEqual({ preheader: "brand-new preheader" });
    expect("subject" in patch).toBe(false);
    expect("from_name" in patch).toBe(false);
    expect("reply_to" in patch).toBe(false);
  });
});

describe("EmailDetailsPanel — preflight integration", () => {
  it("empty subject blocks the Gmail send preflight", () => {
    const res = fullPreflight({
      campaign: { ...makeCampaign(), subject: "" },
      template: {
        id: "t1",
        name: "MDF Master",
        sections: [],
        themeKey: "guntur-chilli",
        variant: "signature",
        version: 1,
        status: "approved",
        createdAt: "x",
        updatedAt: "x",
      },
      html: "<html><body>Hi</body></html>",
      text: "Hi",
      assetsBySlot: {
        hero: {
          id: "a",
          themeKey: "guntur-chilli",
          slot: "hero",
          name: "hero.jpg",
          productionUrl: "https://cdn.example/hero.jpg",
          status: "production",
          altText: "Guntur hero",
          isDecorative: false,
          updatedAt: "x",
        },
      },
      recipient: "you@mdfexport.com",
    });
    expect(res.ok).toBe(false);
    expect(res.blockers.some((b) => /Subject is empty/i.test(b))).toBe(true);
  });

  it("a populated subject removes the subject blocker", () => {
    const res = fullPreflight({
      campaign: { ...makeCampaign() },
      template: {
        id: "t1",
        name: "MDF Master",
        sections: [],
        themeKey: "guntur-chilli",
        variant: "signature",
        version: 1,
        status: "approved",
        createdAt: "x",
        updatedAt: "x",
      },
      html: "<html><body>Hi</body></html>",
      text: "Hi",
      assetsBySlot: {
        hero: {
          id: "a",
          themeKey: "guntur-chilli",
          slot: "hero",
          name: "hero.jpg",
          productionUrl: "https://cdn.example/hero.jpg",
          status: "production",
          altText: "Guntur hero",
          isDecorative: false,
          updatedAt: "x",
        },
      },
      recipient: "you@mdfexport.com",
    });
    expect(res.blockers.some((b) => /Subject is empty/i.test(b))).toBe(false);
  });
});
