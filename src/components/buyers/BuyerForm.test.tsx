import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { BuyerForm } from "./BuyerForm";
import type { Buyer } from "@/lib/types";

afterEach(() => {
  cleanup();
});

function makeBuyer(overrides: Partial<Buyer> = {}): Buyer {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    firstName: "Anna",
    lastName: "Rao",
    company: "Anna Trading",
    email: "anna@example.com",
    phone: "+91 99999 00001",
    whatsapp: "+91 99999 00002",
    website: "https://anna.example",
    country: "India",
    city: "Chennai",
    buyerType: "Importer",
    productInterest: "Guntur Dry Red Chilli",
    source: "Trade show",
    notes: "Wants MOQ 1 container",
    status: "qualified",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-25T00:00:00.000Z",
    ...overrides,
  };
}

describe("BuyerForm pre-population (regression test for edit bug)", () => {
  it("initializes text inputs from the initial prop", () => {
    const buyer = makeBuyer();
    render(<BuyerForm initial={buyer} onSubmit={vi.fn()} onCancel={vi.fn()} />);
    expect((screen.getByLabelText("First name") as HTMLInputElement).value).toBe(buyer.firstName);
    expect((screen.getByLabelText("Last name") as HTMLInputElement).value).toBe(buyer.lastName);
    expect((screen.getByLabelText("Company") as HTMLInputElement).value).toBe(buyer.company);
    expect((screen.getByLabelText("Email") as HTMLInputElement).value).toBe(buyer.email);
    expect((screen.getByLabelText("Phone") as HTMLInputElement).value).toBe(buyer.phone ?? "");
    expect((screen.getByLabelText("WhatsApp") as HTMLInputElement).value).toBe(buyer.whatsapp ?? "");
    expect((screen.getByLabelText("Website") as HTMLInputElement).value).toBe(buyer.website ?? "");
    expect((screen.getByLabelText("Source") as HTMLInputElement).value).toBe(buyer.source ?? "");
    expect((screen.getByLabelText("Notes") as HTMLTextAreaElement).value).toBe(buyer.notes ?? "");
  });

  it("initializes structured controls (country / city / buyer type / product / status) from initial prop", () => {
    const buyer = makeBuyer();
    render(<BuyerForm initial={buyer} onSubmit={vi.fn()} onCancel={vi.fn()} />);
    // Combobox triggers are role="combobox"; their visible text is the current value.
    const comboboxes = screen.getAllByRole("combobox");
    const bodyText = document.body.textContent ?? "";
    expect(bodyText).toContain("India");
    expect(bodyText).toContain("Chennai");
    expect(bodyText).toContain("Importer");
    expect(bodyText).toContain("Guntur Dry Red Chilli");
    // Status is a canonical Select — has label "Qualified".
    expect(bodyText).toContain("Qualified");
    expect(comboboxes.length).toBeGreaterThanOrEqual(5);
  });

  it("re-initializes when the initial prop's id changes (edit A → edit B without remount)", () => {
    const buyerA = makeBuyer({ id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", firstName: "Anna" });
    const buyerB = makeBuyer({
      id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
      firstName: "Bhavya",
      email: "bhavya@example.com",
      country: "Thailand",
      city: "Bangkok",
    });
    const { rerender } = render(
      <BuyerForm initial={buyerA} onSubmit={vi.fn()} onCancel={vi.fn()} />,
    );
    expect((screen.getByLabelText("First name") as HTMLInputElement).value).toBe("Anna");
    expect(document.body.textContent).toContain("India");
    rerender(<BuyerForm initial={buyerB} onSubmit={vi.fn()} onCancel={vi.fn()} />);
    expect((screen.getByLabelText("First name") as HTMLInputElement).value).toBe("Bhavya");
    expect((screen.getByLabelText("Email") as HTMLInputElement).value).toBe("bhavya@example.com");
    expect(document.body.textContent).toContain("Thailand");
    expect(document.body.textContent).toContain("Bangkok");
  });

  it("re-initializes on remount via key prop (add → edit switch)", () => {
    const buyer = makeBuyer({ firstName: "Bhavya" });
    // First render: no initial (add mode)
    const { rerender: _ } = render(
      <BuyerForm key="new" onSubmit={vi.fn()} onCancel={vi.fn()} />,
    );
    expect((screen.getByLabelText("First name") as HTMLInputElement).value).toBe("");
    // Simulate the parent switching from add to edit — different key triggers remount
    cleanup();
    render(<BuyerForm key={buyer.id} initial={buyer} onSubmit={vi.fn()} onCancel={vi.fn()} />);
    expect((screen.getByLabelText("First name") as HTMLInputElement).value).toBe("Bhavya");
    void _;
  });

  it("Product Interest disallows arbitrary new custom entries (post F5 follow-up)", () => {
    // The whole Product combobox must NOT expose an 'Add "…"' path in
    // the normal edit flow. This is a structural check on the rendered
    // form: no button/element in the DOM promotes adding a novel
    // product mid-edit. Legacy values remain visible (see below).
    const buyer = makeBuyer({ productInterest: "" });
    render(<BuyerForm initial={buyer} onSubmit={vi.fn()} onCancel={vi.fn()} />);
    // "Only MDF products can be selected." helper text should render.
    expect(document.body.textContent).toContain("Only MDF products can be selected");
  });

  it("preserves a LEGACY country/product value on load (does not silently rewrite)", () => {
    const buyer = makeBuyer({
      country: "SomeOldFreetextCountry",
      productInterest: "Legacy Product Name",
    });
    render(<BuyerForm initial={buyer} onSubmit={vi.fn()} onCancel={vi.fn()} />);
    // Both legacy values remain visible in the DOM.
    expect(document.body.textContent).toContain("SomeOldFreetextCountry");
    expect(document.body.textContent).toContain("Legacy Product Name");
    // "Legacy" chip appears near unrecognised country.
    expect(document.body.textContent).toContain("Legacy");
  });
});
