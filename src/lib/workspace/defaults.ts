import type { WorkspaceSettings } from "@/lib/types";
import { createDefaultTemplate } from "@/lib/email/defaultTemplate";
import type { EmailTemplate } from "@/lib/types";

// Production-safe defaults. Contains no fictional business data.
// Company/brand/email fields are placeholders MDF operators overwrite in Settings.
export function createDefaultSettings(): WorkspaceSettings {
  const now = new Date().toISOString();
  return {
    id: "singleton",
    onboardingComplete: false,
    createdAt: now,
    updatedAt: now,
    company: {
      companyName: "MDF Exports & Imports",
      shortName: "MDF",
      tagline: "",
      heritage: "",
      location: "",
      website: "",
      email: "",
    },
    brand: {
      orange: "#F36B21",
      charcoal: "#151515",
      ivory: "#FAF8F4",
      chilli: "#A62921",
    },
    email: {
      fromName: "MDF Exports & Imports",
      replyTo: "",
      websiteUrl: "",
      whatsappUrl: "",
      linkedinUrl: "",
      instagramUrl: "",
      defaultCtaUrl: "",
      defaultSubject: "",
      defaultPreheader: "",
    },
  };
}

// The email template shell used when the workspace has no custom template.
// The renderer needs at least one template; the layout is not fictional
// business data — it's the empty template chrome.
export function createInitialTemplate(): EmailTemplate {
  const t = createDefaultTemplate();
  t.isDemo = false;
  return t;
}
