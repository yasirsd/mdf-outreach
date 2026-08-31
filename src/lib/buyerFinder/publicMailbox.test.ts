import { describe, expect, it } from "vitest";
import {
  classifyMailboxKind,
  classifyMailboxType,
  comparePublicEmails,
  mailboxRoleRank,
  selectPrimaryPublicEmail,
} from "./publicMailbox";

describe("mailbox classification", () => {
  it("classifies corporate vs published external mailboxes", () => {
    expect(classifyMailboxKind("imports@company.com", "company.com")).toBe("corporate");
    expect(classifyMailboxKind("trade@gmail.com", "company.com")).toBe("external");
  });

  it("classifies role vs named local-parts", () => {
    expect(classifyMailboxType("procurement@company.com")).toBe("procurement");
    expect(classifyMailboxType("john.smith@company.com")).toBe("named");
    expect(classifyMailboxType("privacy@company.com")).toBe("support");
  });
});

describe("mailbox ranking", () => {
  it("ranks procurement above sales, sales above info, info above privacy", () => {
    expect(mailboxRoleRank("procurement@x.com")).toBeLessThan(mailboxRoleRank("sales@x.com"));
    expect(mailboxRoleRank("sales@x.com")).toBeLessThan(mailboxRoleRank("info@x.com"));
    expect(mailboxRoleRank("info@x.com")).toBeLessThan(mailboxRoleRank("privacy@x.com"));
  });

  it("prefers corporate domain when roles tie, then lexical email", () => {
    const primary = selectPrimaryPublicEmail([
      {
        email: "sales@gmail.com",
        mailboxKind: "external",
        sourceUrl: "https://company.com/contact",
      },
      {
        email: "sales@company.com",
        mailboxKind: "corporate",
        sourceUrl: "https://company.com/contact",
      },
    ]);
    expect(primary?.email).toBe("sales@company.com");
  });

  it("is deterministic on a lexical tie-break", () => {
    const a = {
      email: "aaa@company.com",
      mailboxKind: "corporate" as const,
      sourceUrl: "https://company.com/",
    };
    const b = {
      email: "zzz@company.com",
      mailboxKind: "corporate" as const,
      sourceUrl: "https://company.com/",
    };
    expect(comparePublicEmails(a, b)).toBeLessThan(0);
    expect(selectPrimaryPublicEmail([b, a])?.email).toBe("aaa@company.com");
  });
});
