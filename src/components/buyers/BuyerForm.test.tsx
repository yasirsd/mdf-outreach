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
    productInterest: "Dry Red Chilli",
    source: "Trade show",
    notes: "Wants MOQ 1 container",
    status: "qualified",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-25T00:00:00.000Z",
    ...overrides,
  };
}

describe("BuyerForm pre-population (regression test for edit bug)", () => {
  it("initializes every input from the initial prop", () => {
    const buyer = makeBuyer();
    render(<BuyerForm initial={buyer} onSubmit={vi.fn()} onCancel={vi.fn()} />);
    expect((screen.getByLabelText("First name") as HTMLInputElement).value).toBe(buyer.firstName);
    expect((screen.getByLabelText("Last name") as HTMLInputElement).value).toBe(buyer.lastName);
    expect((screen.getByLabelText("Company") as HTMLInputElement).value).toBe(buyer.company);
    expect((screen.getByLabelText("Email") as HTMLInputElement).value).toBe(buyer.email);
    expect((screen.getByLabelText("Country") as HTMLInputElement).value).toBe(buyer.country);
    expect((screen.getByLabelText("City") as HTMLInputElement).value).toBe(buyer.city ?? "");
    expect((screen.getByLabelText("Phone") as HTMLInputElement).value).toBe(buyer.phone ?? "");
    expect((screen.getByLabelText("WhatsApp") as HTMLInputElement).value).toBe(buyer.whatsapp ?? "");
    expect((screen.getByLabelText("Website") as HTMLInputElement).value).toBe(buyer.website ?? "");
    expect((screen.getByLabelText("Buyer type") as HTMLInputElement).value).toBe(buyer.buyerType ?? "");
    expect((screen.getByLabelText("Product interest") as HTMLInputElement).value).toBe(
      buyer.productInterest ?? "",
    );
    expect((screen.getByLabelText("Source") as HTMLInputElement).value).toBe(buyer.source ?? "");
    expect((screen.getByLabelText("Status") as HTMLSelectElement).value).toBe(buyer.status);
    expect((screen.getByLabelText("Notes") as HTMLTextAreaElement).value).toBe(buyer.notes ?? "");
  });

  it("re-initializes when the initial prop's id changes (edit A → edit B without remount)", () => {
    const buyerA = makeBuyer({ id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", firstName: "Anna" });
    const buyerB = makeBuyer({ id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", firstName: "Bhavya", email: "bhavya@example.com" });
    const { rerender } = render(
      <BuyerForm initial={buyerA} onSubmit={vi.fn()} onCancel={vi.fn()} />,
    );
    expect((screen.getByLabelText("First name") as HTMLInputElement).value).toBe("Anna");
    rerender(<BuyerForm initial={buyerB} onSubmit={vi.fn()} onCancel={vi.fn()} />);
    expect((screen.getByLabelText("First name") as HTMLInputElement).value).toBe("Bhavya");
    expect((screen.getByLabelText("Email") as HTMLInputElement).value).toBe("bhavya@example.com");
  });

  it("re-initializes on remount via key prop (add → edit switch)", () => {
    const buyer = makeBuyer({ firstName: "Bhavya" });
    // First render: no initial (add mode)
    const { rerender } = render(
      <BuyerForm key="new" onSubmit={vi.fn()} onCancel={vi.fn()} />,
    );
    expect((screen.getByLabelText("First name") as HTMLInputElement).value).toBe("");
    // Simulate the parent switching from add to edit — different key triggers remount
    cleanup();
    render(<BuyerForm key={buyer.id} initial={buyer} onSubmit={vi.fn()} onCancel={vi.fn()} />);
    expect((screen.getByLabelText("First name") as HTMLInputElement).value).toBe("Bhavya");
  });
});
