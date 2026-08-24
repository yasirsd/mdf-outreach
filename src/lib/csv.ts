import Papa from "papaparse";
import type { Buyer, BuyerStatus } from "@/lib/types";
import { isValidEmail, uid } from "@/lib/utils";

const HEADER_ALIASES: Record<string, keyof Buyer> = {
  first_name: "firstName",
  firstname: "firstName",
  "first name": "firstName",
  given_name: "firstName",
  last_name: "lastName",
  lastname: "lastName",
  "last name": "lastName",
  surname: "lastName",
  family_name: "lastName",
  company: "company",
  organization: "company",
  organisation: "company",
  business: "company",
  email: "email",
  "email address": "email",
  phone: "phone",
  "phone number": "phone",
  telephone: "phone",
  whatsapp: "whatsapp",
  wa: "whatsapp",
  website: "website",
  url: "website",
  country: "country",
  city: "city",
  buyer_type: "buyerType",
  "buyer type": "buyerType",
  product: "productInterest",
  product_interest: "productInterest",
  interest: "productInterest",
  source: "source",
  notes: "notes",
  status: "status",
};

const STATUS_ALIASES: Record<string, BuyerStatus> = {
  new: "new",
  qualified: "qualified",
  "ready": "ready",
  "ready to contact": "ready",
  contacted: "contacted",
  replied: "replied",
  interested: "interested",
  "quotation sent": "quotation-sent",
  "quotation-sent": "quotation-sent",
  negotiating: "negotiating",
  converted: "converted",
  "not interested": "not-interested",
  "not-interested": "not-interested",
};

export interface CsvRow {
  [key: string]: string;
}

export interface CsvMapping {
  [csvHeader: string]: keyof Buyer | "";
}

export interface CsvParseResult {
  headers: string[];
  rows: CsvRow[];
  autoMapping: CsvMapping;
}

export function parseCsvFile(file: File): Promise<CsvParseResult> {
  return new Promise((resolve, reject) => {
    Papa.parse<CsvRow>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const headers = results.meta.fields ?? [];
        const rows = results.data.map((r) => {
          const trimmed: CsvRow = {};
          for (const h of headers) {
            const v = (r[h] ?? "").toString().trim();
            trimmed[h] = v;
          }
          return trimmed;
        });
        const autoMapping: CsvMapping = {};
        for (const h of headers) {
          const norm = h.trim().toLowerCase();
          autoMapping[h] = HEADER_ALIASES[norm] ?? "";
        }
        resolve({ headers, rows, autoMapping });
      },
      error: (err) => reject(err),
    });
  });
}

export interface MappedBuyerDraft {
  buyer: Buyer;
  valid: boolean;
  errors: string[];
}

export function mapCsvToBuyers(rows: CsvRow[], mapping: CsvMapping): MappedBuyerDraft[] {
  const now = new Date().toISOString();
  return rows.map((row) => {
    const draft: Partial<Buyer> = {
      id: uid("buy"),
      status: "new",
      createdAt: now,
      updatedAt: now,
    };
    for (const [csvHeader, field] of Object.entries(mapping)) {
      if (!field) continue;
      const raw = (row[csvHeader] ?? "").trim();
      if (!raw) continue;
      if (field === "status") {
        const s = STATUS_ALIASES[raw.toLowerCase()];
        if (s) draft.status = s;
      } else {
        (draft as Record<string, unknown>)[field] = raw;
      }
    }
    const errors: string[] = [];
    if (!draft.firstName && !draft.lastName && !draft.company) {
      errors.push("Row has no name or company");
    }
    if (!draft.email) errors.push("Missing email");
    else if (!isValidEmail(draft.email)) errors.push("Invalid email");
    if (!draft.country) draft.country = "";
    const buyer: Buyer = {
      id: draft.id!,
      firstName: draft.firstName ?? "",
      lastName: draft.lastName ?? "",
      company: draft.company ?? "",
      email: (draft.email ?? "").toLowerCase(),
      phone: draft.phone,
      whatsapp: draft.whatsapp,
      website: draft.website,
      country: draft.country ?? "",
      city: draft.city,
      buyerType: draft.buyerType,
      productInterest: draft.productInterest,
      source: draft.source,
      notes: draft.notes,
      status: draft.status as BuyerStatus,
      createdAt: now,
      updatedAt: now,
    };
    return { buyer, valid: errors.length === 0, errors };
  });
}

export function buyersToCsv(buyers: Buyer[]): string {
  const rows = buyers.map((b) => ({
    first_name: b.firstName,
    last_name: b.lastName,
    company: b.company,
    email: b.email,
    phone: b.phone ?? "",
    whatsapp: b.whatsapp ?? "",
    website: b.website ?? "",
    country: b.country,
    city: b.city ?? "",
    buyer_type: b.buyerType ?? "",
    product: b.productInterest ?? "",
    source: b.source ?? "",
    status: b.status,
    notes: b.notes ?? "",
  }));
  return Papa.unparse(rows);
}
