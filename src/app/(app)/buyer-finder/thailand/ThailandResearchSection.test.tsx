import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, waitFor } from "@testing-library/react";

vi.mock("server-only", () => ({}));

const getAggregateMock = vi.hoisted(() => vi.fn());
const getManualMock = vi.hoisted(() => vi.fn());
const getHistoryMock = vi.hoisted(() => vi.fn());
vi.mock("./getThailandAggregateAction", () => ({
  getThailandAggregateForCandidateAction: getAggregateMock,
}));
vi.mock("../thailandManualEvidenceActions", () => ({
  getThailandManualEvidenceForCandidateAction: getManualMock,
  getThailandManualEvidenceHistoryAction: getHistoryMock,
  recordThailandManualEvidenceAction: vi.fn(),
  supersedeThailandManualEvidenceAction: vi.fn(),
  withdrawThailandManualEvidenceAction: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { ThailandResearchSection } from "./ThailandResearchSection";
import { aggregateThailandResearch } from "@/lib/tradeResearch/thailand";

const CANDIDATE = "22222222-2222-4222-8222-222222222222";

beforeEach(() => {
  getAggregateMock.mockReset();
  getManualMock.mockReset();
  getHistoryMock.mockReset();
  getHistoryMock.mockResolvedValue({ dbd: [], customsOperator: [], fdaImporter: [] });
});
afterEach(() => { vi.restoreAllMocks(); });

describe("TH06 FINAL — Thailand market gate in CandidateView", () => {
  it("1. TH candidate → ThailandEvidencePanel + manual cards rendered via mounted section", async () => {
    const aggregate = aggregateThailandResearch({ manual: { conflicts: [] } });
    getAggregateMock.mockResolvedValue({ isThailandMarket: true, aggregate, productSupported: true });
    getManualMock.mockResolvedValue({ conflicts: [] });
    const { container } = render(<ThailandResearchSection candidateId={CANDIDATE} marketCountryCode="TH" />);
    await waitFor(() => expect(container.querySelector('[data-thailand-research="ready"]')).not.toBeNull());
    const text = container.textContent ?? "";
    expect(text).toContain("Thailand research");
    expect(text).toContain("DBD Company Registry");
    expect(text).toContain("Thai Customs Operator Registry");
    expect(text).toContain("Thai FDA Food Import Licence");
    expect(getAggregateMock).toHaveBeenCalledWith(CANDIDATE, expect.objectContaining({ candidateProductIds: expect.anything() }));
  });

  it("2. US candidate → Thailand panel absent (nothing renders)", async () => {
    const { container } = render(<ThailandResearchSection candidateId={CANDIDATE} marketCountryCode="US" />);
    // No fetch should happen; the component returns null synchronously.
    expect(getAggregateMock).not.toHaveBeenCalled();
    expect(container.innerHTML).toBe("");
  });

  it("3. CA candidate → Thailand panel absent", async () => {
    const { container } = render(<ThailandResearchSection candidateId={CANDIDATE} marketCountryCode="CA" />);
    expect(getAggregateMock).not.toHaveBeenCalled();
    expect(container.innerHTML).toBe("");
  });

  it("4. no marketCountryCode → Thailand panel absent", async () => {
    const { container } = render(<ThailandResearchSection candidateId={CANDIDATE} />);
    expect(getAggregateMock).not.toHaveBeenCalled();
    expect(container.innerHTML).toBe("");
  });

  it("5/6. real aggregate is loaded via the server action — no fixture synthesis in the component", async () => {
    const aggregate = aggregateThailandResearch({
      manual: { conflicts: [] },
      thaiCustomsStats: {
        status: "completed", marketImportActivity: "observed",
        indiaOriginMarketActivity: "observed", productRelevance: "observed",
      },
    });
    getAggregateMock.mockResolvedValue({ isThailandMarket: true, aggregate, productSupported: true });
    getManualMock.mockResolvedValue({ conflicts: [] });
    const { container } = render(<ThailandResearchSection candidateId={CANDIDATE} marketCountryCode="TH" />);
    await waitFor(() => expect(container.querySelector('[data-thailand-research="ready"]')).not.toBeNull());
    const text = container.textContent ?? "";
    expect(text).toContain("Observed"); // market import activity surfaced
    expect(text).toContain("India-origin market activity");
    // The component never writes "This company imports from India" / forbidden phrases.
    expect(text).not.toMatch(/This company imports from India/i);
    expect(text).not.toMatch(/verified buyer/i);
    expect(text).not.toMatch(/strong buyer/i);
  });

  it("17. missing-website scenario — Thailand aggregate still renders (Customs stats can be present without website)", async () => {
    const aggregate = aggregateThailandResearch({
      manual: { conflicts: [] },
      thaiCustomsStats: {
        status: "completed", marketImportActivity: "observed",
        indiaOriginMarketActivity: "not_observed", productRelevance: "observed",
      },
      // no publicWebsite — simulates candidate without a domain
    });
    getAggregateMock.mockResolvedValue({ isThailandMarket: true, aggregate, productSupported: true });
    getManualMock.mockResolvedValue({ conflicts: [] });
    const { container } = render(<ThailandResearchSection candidateId={CANDIDATE} marketCountryCode="TH" />);
    await waitFor(() => expect(container.querySelector('[data-thailand-research="ready"]')).not.toBeNull());
    const text = container.textContent ?? "";
    expect(text).toContain("Observed");
    expect(text).toContain("Not observed"); // India-origin not_observed
  });

  it("16/24. company_shipment_activity remains Unknown even in a fully covered scenario", async () => {
    const aggregate = aggregateThailandResearch({
      manual: { conflicts: [] },
      thaiCustomsStats: {
        status: "completed", marketImportActivity: "observed",
        indiaOriginMarketActivity: "observed", productRelevance: "observed",
      },
      publicWebsite: {
        status: "completed", productSignalsObserved: true, identityMatchLevel: "strong",
        observedPublicEmails: ["info@x.co.th"], observedPublicPhones: [],
      },
    });
    getAggregateMock.mockResolvedValue({ isThailandMarket: true, aggregate, productSupported: true });
    getManualMock.mockResolvedValue({ conflicts: [] });
    const { container } = render(<ThailandResearchSection candidateId={CANDIDATE} marketCountryCode="TH" />);
    await waitFor(() => expect(container.querySelector('[data-thailand-research="ready"]')).not.toBeNull());
    const text = container.textContent ?? "";
    expect(text).toContain("Company shipment activity");
    expect(text).toContain("Unknown");
  });

  it("case-insensitive market gate — 'th' lowercase also mounts the panel", async () => {
    const aggregate = aggregateThailandResearch({ manual: { conflicts: [] } });
    getAggregateMock.mockResolvedValue({ isThailandMarket: true, aggregate, productSupported: true });
    getManualMock.mockResolvedValue({ conflicts: [] });
    const { container } = render(<ThailandResearchSection candidateId={CANDIDATE} marketCountryCode="th" />);
    await waitFor(() => expect(container.querySelector('[data-thailand-research="ready"]')).not.toBeNull());
  });
});

describe("TH06 FINAL — Issue 1: unsupported product/form banner", () => {
  it("A1. productSupported=false → section visibly renders the unsupported-product message", async () => {
    const aggregate = aggregateThailandResearch({ manual: { conflicts: [] } });
    getAggregateMock.mockResolvedValue({
      isThailandMarket: true,
      aggregate,
      productSupported: false,
      unsupportedProductMessage: "Thailand trade research is not available for this product/form.",
    });
    getManualMock.mockResolvedValue({ conflicts: [] });
    const { container } = render(<ThailandResearchSection candidateId={CANDIDATE} marketCountryCode="TH" />);
    await waitFor(() => expect(container.querySelector('[data-thailand-research="ready"]')).not.toBeNull());
    const banner = container.querySelector('[data-thailand-unsupported-product="true"]');
    expect(banner).not.toBeNull();
    expect((banner?.textContent ?? "").toLowerCase()).toContain("not available for this product/form");
    // Must not imply success/strong buyer language.
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/successfully/i);
    expect(text).not.toMatch(/verified buyer/i);
    expect(text).not.toMatch(/strong buyer/i);
  });

  it("A2. productSupported=true → unsupported banner is absent", async () => {
    const aggregate = aggregateThailandResearch({ manual: { conflicts: [] } });
    getAggregateMock.mockResolvedValue({ isThailandMarket: true, aggregate, productSupported: true });
    getManualMock.mockResolvedValue({ conflicts: [] });
    const { container } = render(<ThailandResearchSection candidateId={CANDIDATE} marketCountryCode="TH" />);
    await waitFor(() => expect(container.querySelector('[data-thailand-research="ready"]')).not.toBeNull());
    expect(container.querySelector('[data-thailand-unsupported-product="true"]')).toBeNull();
  });
});

describe("TH06 FINAL — Issue 3: Manual evidence history wiring", () => {
  const AGG = () => aggregateThailandResearch({ manual: { conflicts: [] } });

  const historyRows = {
    dbd: [
      {
        id: "r2", provider_id: "thai-dbd" as const, evidence_status: "verified" as const,
        captured_at: "2026-10-02T02:00:00.000Z",
        captured_by_user_id: "11111111-1111-4111-8111-111111111111",
        source_url: "https://datawarehouse.dbd.go.th/x", source_label: "DBD lookup v2",
        supersedes_id: "r1", superseded_by_id: null,
        lookup_basis: "juristic_number", lookup_basis_detail: null,
        historyStatus: "current" as const,
      },
      {
        id: "r1", provider_id: "thai-dbd" as const, evidence_status: "verified" as const,
        captured_at: "2026-10-02T01:00:00.000Z",
        captured_by_user_id: "11111111-1111-4111-8111-111111111111",
        source_url: "https://datawarehouse.dbd.go.th/x", source_label: "DBD lookup v1",
        supersedes_id: null, superseded_by_id: "r2",
        lookup_basis: null, lookup_basis_detail: null,
        historyStatus: "superseded" as const,
      },
    ],
    customsOperator: [
      {
        id: "c1", provider_id: "thai-customs-operator" as const, evidence_status: "withdrawn" as const,
        captured_at: "2026-10-02T00:30:00.000Z",
        captured_by_user_id: "11111111-1111-4111-8111-111111111111",
        source_url: "https://www.customs.go.th/x", source_label: "Customs operator lookup",
        supersedes_id: null, superseded_by_id: null,
        lookup_basis: null, lookup_basis_detail: null,
        historyStatus: "withdrawn" as const,
      },
    ],
    fdaImporter: [] as never[],
  };

  it("C1. History (N) affordance renders for providers with history rows", async () => {
    getAggregateMock.mockResolvedValue({ isThailandMarket: true, aggregate: AGG(), productSupported: true });
    getManualMock.mockResolvedValue({ conflicts: [] });
    getHistoryMock.mockResolvedValue(historyRows);
    const { container } = render(<ThailandResearchSection candidateId={CANDIDATE} marketCountryCode="TH" />);
    await waitFor(() => expect(container.querySelector('[data-thailand-research="ready"]')).not.toBeNull());
    const text = container.textContent ?? "";
    expect(text).toContain("History (2)"); // DBD has 2 rows
    expect(text).toContain("History (1)"); // Customs operator has 1 row
  });

  it("C2. clicking History expands the panel and renders Current/Superseded labels in order", async () => {
    getAggregateMock.mockResolvedValue({ isThailandMarket: true, aggregate: AGG(), productSupported: true });
    getManualMock.mockResolvedValue({ conflicts: [] });
    getHistoryMock.mockResolvedValue(historyRows);
    const { container } = render(<ThailandResearchSection candidateId={CANDIDATE} marketCountryCode="TH" />);
    await waitFor(() => expect(container.querySelector('[data-thailand-research="ready"]')).not.toBeNull());
    const toggles = Array.from(container.querySelectorAll("button")).filter((b) => /^History \(\d+\)$/.test(b.textContent ?? ""));
    expect(toggles.length).toBeGreaterThan(0);
    // Expand the DBD history (first toggle).
    act(() => { fireEvent.click(toggles[0]!); });
    const dbdHistory = container.querySelector('[data-history-provider="thai-dbd"]');
    expect(dbdHistory).not.toBeNull();
    const items = Array.from(dbdHistory!.querySelectorAll('[data-history-id]')) as HTMLElement[];
    expect(items).toHaveLength(2);
    expect(items[0]!.getAttribute("data-history-status")).toBe("current");
    expect(items[1]!.getAttribute("data-history-status")).toBe("superseded");
    expect(items[0]!.textContent).toContain("Current");
    expect(items[1]!.textContent).toContain("Superseded");
    // Supersedes/Superseded-by metadata rendered.
    expect(items[0]!.textContent).toContain("Supersedes");
    expect(items[1]!.textContent).toContain("Superseded by");
  });

  it("C3. withdrawn row is labelled Withdrawn with correct data-history-status", async () => {
    getAggregateMock.mockResolvedValue({ isThailandMarket: true, aggregate: AGG(), productSupported: true });
    getManualMock.mockResolvedValue({ conflicts: [] });
    getHistoryMock.mockResolvedValue(historyRows);
    const { container } = render(<ThailandResearchSection candidateId={CANDIDATE} marketCountryCode="TH" />);
    await waitFor(() => expect(container.querySelector('[data-thailand-research="ready"]')).not.toBeNull());
    const toggles = Array.from(container.querySelectorAll("button")).filter((b) => /^History \(\d+\)$/.test(b.textContent ?? ""));
    // Customs operator is the 2nd card with history.
    act(() => { fireEvent.click(toggles[1]!); });
    const customs = container.querySelector('[data-history-provider="thai-customs-operator"]');
    expect(customs).not.toBeNull();
    const item = customs!.querySelector('[data-history-id]') as HTMLElement;
    expect(item.getAttribute("data-history-status")).toBe("withdrawn");
    expect(item.textContent).toContain("Withdrawn");
  });

  it("C4. source link + captured timestamp are rendered inside history rows", async () => {
    getAggregateMock.mockResolvedValue({ isThailandMarket: true, aggregate: AGG(), productSupported: true });
    getManualMock.mockResolvedValue({ conflicts: [] });
    getHistoryMock.mockResolvedValue(historyRows);
    const { container } = render(<ThailandResearchSection candidateId={CANDIDATE} marketCountryCode="TH" />);
    await waitFor(() => expect(container.querySelector('[data-thailand-research="ready"]')).not.toBeNull());
    const toggles = Array.from(container.querySelectorAll("button")).filter((b) => /^History \(\d+\)$/.test(b.textContent ?? ""));
    act(() => { fireEvent.click(toggles[0]!); });
    const dbdHistory = container.querySelector('[data-history-provider="thai-dbd"]')!;
    const link = dbdHistory.querySelector('a[href="https://datawarehouse.dbd.go.th/x"]');
    expect(link).not.toBeNull();
    expect(dbdHistory.textContent).toContain("2026-10-02T02:00:00.000Z");
    expect(dbdHistory.textContent).toContain("DBD lookup v2");
  });

  it("D. history is read-only — no edit input/select/textarea inside history rows", async () => {
    getAggregateMock.mockResolvedValue({ isThailandMarket: true, aggregate: AGG(), productSupported: true });
    // Provide an active DBD row so the card renders the "Correct (supersede)" affordance.
    getManualMock.mockResolvedValue({
      conflicts: [],
      dbd: {
        id: "r2",
        workspace_id: "ws",
        candidate_id: CANDIDATE,
        provider_id: "thai-dbd",
        captured_by_user_id: "11111111-1111-4111-8111-111111111111",
        source_url: "https://datawarehouse.dbd.go.th/x",
        source_label: "DBD lookup v2",
        evidence_payload: {},
        evidence_status: "verified",
        supersedes_id: "r1",
        captured_at: "2026-10-02T02:00:00.000Z",
        created_at: "2026-10-02T02:00:00.000Z",
        lookup_basis: "juristic_number",
        lookup_basis_detail: null,
      },
    });
    getHistoryMock.mockResolvedValue(historyRows);
    const { container } = render(<ThailandResearchSection candidateId={CANDIDATE} marketCountryCode="TH" />);
    await waitFor(() => expect(container.querySelector('[data-thailand-research="ready"]')).not.toBeNull());
    const toggles = Array.from(container.querySelectorAll("button")).filter((b) => /^History \(\d+\)$/.test(b.textContent ?? ""));
    act(() => { fireEvent.click(toggles[0]!); });
    const dbdHistory = container.querySelector('[data-history-provider="thai-dbd"]')!;
    // No form controls allowed within the history panel.
    expect(dbdHistory.querySelector("input")).toBeNull();
    expect(dbdHistory.querySelector("select")).toBeNull();
    expect(dbdHistory.querySelector("textarea")).toBeNull();
    expect(dbdHistory.querySelector("button")).toBeNull();
    // Correction still only via the card's Correct (supersede) action, which lives OUTSIDE the history panel.
    const correctButtons = Array.from(container.querySelectorAll("button")).filter((b) => b.textContent?.includes("Correct (supersede)"));
    expect(correctButtons.length).toBeGreaterThan(0);
  });
});

describe("TH06 FINAL — Issue 2 (card integration): operator type field", () => {
  const AGG = () => aggregateThailandResearch({ manual: { conflicts: [] } });

  it("Customs operator card exposes operatorTypeSnapshot select when the form is opened", async () => {
    getAggregateMock.mockResolvedValue({ isThailandMarket: true, aggregate: AGG(), productSupported: true });
    getManualMock.mockResolvedValue({ conflicts: [] });
    getHistoryMock.mockResolvedValue({ dbd: [], customsOperator: [], fdaImporter: [] });
    const { container } = render(<ThailandResearchSection candidateId={CANDIDATE} marketCountryCode="TH" />);
    await waitFor(() => expect(container.querySelector('[data-thailand-research="ready"]')).not.toBeNull());
    const customsCard = Array.from(container.querySelectorAll("section")).find((s) => s.getAttribute("aria-label") === "Thai Customs Operator Registry");
    expect(customsCard).toBeDefined();
    const recordButton = Array.from(customsCard!.querySelectorAll("button")).find((b) => b.textContent === "Record result");
    expect(recordButton).toBeDefined();
    act(() => { fireEvent.click(recordButton!); });
    const operatorSelect = customsCard!.querySelector('select[name="operatorTypeSnapshot"]') as HTMLSelectElement | null;
    expect(operatorSelect).not.toBeNull();
    // Verified is the default evidenceStatus — operatorTypeSnapshot must be required.
    expect(operatorSelect!.required).toBe(true);
    const options = Array.from(operatorSelect!.querySelectorAll("option")).map((o) => o.value);
    expect(options).toEqual(expect.arrayContaining(["", "importer", "exporter", "broker", "aeo", "other"]));
    // Default value is empty — never "importer".
    expect(operatorSelect!.value).toBe("");
  });

  it("DBD card does NOT expose operatorTypeSnapshot (not an operator-registry provider)", async () => {
    getAggregateMock.mockResolvedValue({ isThailandMarket: true, aggregate: AGG(), productSupported: true });
    getManualMock.mockResolvedValue({ conflicts: [] });
    getHistoryMock.mockResolvedValue({ dbd: [], customsOperator: [], fdaImporter: [] });
    const { container } = render(<ThailandResearchSection candidateId={CANDIDATE} marketCountryCode="TH" />);
    await waitFor(() => expect(container.querySelector('[data-thailand-research="ready"]')).not.toBeNull());
    const dbdCard = Array.from(container.querySelectorAll("section")).find((s) => s.getAttribute("aria-label") === "DBD Company Registry");
    expect(dbdCard).toBeDefined();
    const recordButton = Array.from(dbdCard!.querySelectorAll("button")).find((b) => b.textContent === "Record result");
    act(() => { fireEvent.click(recordButton!); });
    expect(dbdCard!.querySelector('select[name="operatorTypeSnapshot"]')).toBeNull();
  });
});

describe("TH06 FINAL — Issue E: US/CA regression safety with history + context additions", () => {
  it("US candidate still renders nothing and makes no server calls — even with history action available", async () => {
    const { container } = render(<ThailandResearchSection candidateId={CANDIDATE} marketCountryCode="US" />);
    expect(getAggregateMock).not.toHaveBeenCalled();
    expect(getManualMock).not.toHaveBeenCalled();
    expect(getHistoryMock).not.toHaveBeenCalled();
    expect(container.innerHTML).toBe("");
  });

  it("CA candidate still renders nothing and makes no server calls", async () => {
    const { container } = render(<ThailandResearchSection candidateId={CANDIDATE} marketCountryCode="CA" />);
    expect(getAggregateMock).not.toHaveBeenCalled();
    expect(getManualMock).not.toHaveBeenCalled();
    expect(getHistoryMock).not.toHaveBeenCalled();
    expect(container.innerHTML).toBe("");
  });
});
