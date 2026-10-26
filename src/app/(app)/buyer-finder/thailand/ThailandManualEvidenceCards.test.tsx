import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";

vi.mock("server-only", () => ({}));

vi.mock("../thailandManualEvidenceActions", () => ({
  recordThailandManualEvidenceAction: vi.fn(),
  supersedeThailandManualEvidenceAction: vi.fn(),
  withdrawThailandManualEvidenceAction: vi.fn(),
}));

import { ThailandCustomsOperatorCard, ThailandFdaCard } from "./ThailandManualEvidenceCards";

const CANDIDATE = "22222222-2222-4222-8222-222222222222";

function openFdaForm() {
  const view = render(<ThailandFdaCard candidateId={CANDIDATE} />);
  const record = [...view.container.querySelectorAll("button")].find((b) => b.textContent === "Record result");
  expect(record).toBeTruthy();
  fireEvent.click(record!);
  const form = view.container.querySelector("form");
  expect(form).not.toBeNull();
  return { ...view, form: form as HTMLFormElement };
}

function licenseNumberInput(form: HTMLFormElement): HTMLInputElement {
  const input = form.querySelector('input[name="licenseNumberSnapshot"]');
  expect(input).toBeInstanceOf(HTMLInputElement);
  return input as HTMLInputElement;
}

function resultSelect(form: HTMLFormElement): HTMLSelectElement {
  const select = form.querySelector('select[name="evidenceStatus"]');
  expect(select).toBeInstanceOf(HTMLSelectElement);
  return select as HTMLSelectElement;
}

afterEach(() => { vi.restoreAllMocks(); });

describe("Thai FDA Food Import Licence form — licence number required only when verified", () => {
  it("verified → licence number is required; type and dates are not", () => {
    const { form } = openFdaForm();
    expect(resultSelect(form).value).toBe("verified");
    expect(licenseNumberInput(form).required).toBe(true);
    expect((form.querySelector('input[name="licenseTypeSnapshot"]') as HTMLInputElement).required).toBe(false);
    expect((form.querySelector('input[name="validFromSnapshot"]') as HTMLInputElement).required).toBe(false);
    expect((form.querySelector('input[name="validUntilSnapshot"]') as HTMLInputElement).required).toBe(false);
    expect(form.textContent).toContain("required when verified");
  });

  it("inconclusive → licence number is not required", () => {
    const { form } = openFdaForm();
    fireEvent.change(resultSelect(form), { target: { value: "inconclusive" } });
    expect(resultSelect(form).value).toBe("inconclusive");
    expect(licenseNumberInput(form).required).toBe(false);
    expect(form.textContent).toContain("optional for not found / inconclusive");
  });

  it("not_found → licence number is not required", () => {
    const { form } = openFdaForm();
    fireEvent.change(resultSelect(form), { target: { value: "not_found" } });
    expect(resultSelect(form).value).toBe("not_found");
    expect(licenseNumberInput(form).required).toBe(false);
  });
});

function openCustomsForm() {
  const view = render(<ThailandCustomsOperatorCard candidateId={CANDIDATE} />);
  const record = [...view.container.querySelectorAll("button")].find((b) => b.textContent === "Record result");
  expect(record).toBeTruthy();
  fireEvent.click(record!);
  const form = view.container.querySelector("form");
  expect(form).not.toBeNull();
  return { ...view, form: form as HTMLFormElement };
}

describe("Thai Customs Operator Registry form — registration status has no active default", () => {
  it("starts unselected; active is not the default", () => {
    const { form } = openCustomsForm();
    const status = form.querySelector('select[name="registrationStatusSnapshot"]') as HTMLSelectElement;
    expect(status).toBeInstanceOf(HTMLSelectElement);
    expect(status.value).toBe("");
    expect(status.required).toBe(false);
    expect([...status.options].some((o) => o.value === "")).toBe(true);
  });

  it("inconclusive / not_found keep registration status optional and unselected", () => {
    const { form } = openCustomsForm();
    const status = form.querySelector('select[name="registrationStatusSnapshot"]') as HTMLSelectElement;
    const result = form.querySelector('select[name="evidenceStatus"]') as HTMLSelectElement;
    fireEvent.change(result, { target: { value: "inconclusive" } });
    expect(status.value).toBe("");
    expect(status.required).toBe(false);
    fireEvent.change(result, { target: { value: "not_found" } });
    expect(status.value).toBe("");
    expect(status.required).toBe(false);
  });
});
