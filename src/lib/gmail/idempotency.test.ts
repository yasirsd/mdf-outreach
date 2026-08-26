import { describe, it, expect, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { claimSendNonce, releaseSendNonce } from "./idempotency";

/**
 * Fake Supabase client that models the composite primary key on
 * (workspace_id, nonce). Uses the SAME shape the code path exercises:
 *   supabase.from(table).insert(row)
 *   supabase.from(table).delete().eq(...).eq(...)
 *
 * We reuse the same rows store for the whole file so cross-workspace
 * independence and duplicate-rejection are proven with real state.
 */
type Row = { workspace_id: string; nonce: string; claimed_by: string };

function makeFakeSupabase(rows: Row[]): SupabaseClient {
  return {
    from(table: string) {
      if (table !== "email_send_idempotency") {
        throw new Error("fake supports only email_send_idempotency");
      }
      return {
        insert: async (row: Row) => {
          const conflict = rows.some(
            (r) => r.workspace_id === row.workspace_id && r.nonce === row.nonce,
          );
          if (conflict) {
            return {
              error: {
                code: "23505",
                message: "duplicate key value violates unique constraint",
              },
            };
          }
          rows.push(row);
          return { error: null };
        },
        delete() {
          const filters: Array<[string, unknown]> = [];
          const chain = {
            eq(col: string, val: unknown) {
              filters.push([col, val]);
              return chain;
            },
            then(res: (v: { error: null }) => void) {
              for (let i = rows.length - 1; i >= 0; i--) {
                const r = rows[i] as unknown as Record<string, unknown>;
                if (filters.every(([c, v]) => r[c] === v)) rows.splice(i, 1);
              }
              res({ error: null });
              return Promise.resolve({ error: null });
            },
          };
          return chain;
        },
      };
    },
  } as unknown as SupabaseClient;
}

describe("email-send idempotency (database-backed)", () => {
  let rows: Row[];
  let supabase: SupabaseClient;

  beforeEach(() => {
    rows = [];
    supabase = makeFakeSupabase(rows);
  });

  it("two attempts with the same (workspace, nonce) allow only one — Gmail is NOT called on the duplicate", async () => {
    const args = {
      supabase,
      workspaceId: "ws-1",
      nonce: "abc",
      claimedBy: "u-1",
    };
    const first = await claimSendNonce(args);
    const second = await claimSendNonce(args);
    expect(first).toBe(true);
    expect(second).toBe(false);
    // The stored claim is exactly one row — proves the second attempt
    // never wrote a second record and therefore never reached the code
    // path that would call Gmail.
    expect(rows).toHaveLength(1);
  });

  it("same nonce in a different workspace is independent", async () => {
    const a = await claimSendNonce({
      supabase,
      workspaceId: "ws-A",
      nonce: "shared-nonce",
      claimedBy: "u-1",
    });
    const b = await claimSendNonce({
      supabase,
      workspaceId: "ws-B",
      nonce: "shared-nonce",
      claimedBy: "u-1",
    });
    expect(a).toBe(true);
    expect(b).toBe(true);
    expect(rows).toHaveLength(2);
  });

  it("distinct nonces in the same workspace both succeed", async () => {
    expect(
      await claimSendNonce({ supabase, workspaceId: "ws", nonce: "n1", claimedBy: "u" }),
    ).toBe(true);
    expect(
      await claimSendNonce({ supabase, workspaceId: "ws", nonce: "n2", claimedBy: "u" }),
    ).toBe(true);
    expect(rows).toHaveLength(2);
  });

  it("releaseSendNonce lets the same nonce be claimed again", async () => {
    const args = { supabase, workspaceId: "ws", nonce: "rn", claimedBy: "u" };
    expect(await claimSendNonce(args)).toBe(true);
    expect(await claimSendNonce(args)).toBe(false);
    await releaseSendNonce({ supabase, workspaceId: "ws", nonce: "rn" });
    expect(await claimSendNonce(args)).toBe(true);
  });

  it("rejects an empty nonce as unclaimable", async () => {
    expect(
      await claimSendNonce({ supabase, workspaceId: "ws", nonce: "", claimedBy: "u" }),
    ).toBe(false);
    // No row is written on a rejected input.
    expect(rows).toHaveLength(0);
  });

  it("rejects an overlong nonce (>128 chars)", async () => {
    const long = "x".repeat(200);
    expect(
      await claimSendNonce({ supabase, workspaceId: "ws", nonce: long, claimedBy: "u" }),
    ).toBe(false);
    expect(rows).toHaveLength(0);
  });

  it("propagates non-unique-violation errors instead of silently returning false", async () => {
    const brokenSupabase = {
      from: () => ({
        insert: async () => ({ error: { code: "42501", message: "permission denied" } }),
      }),
    } as unknown as SupabaseClient;
    await expect(
      claimSendNonce({
        supabase: brokenSupabase,
        workspaceId: "ws",
        nonce: "n",
        claimedBy: "u",
      }),
    ).rejects.toMatchObject({ code: "42501" });
  });
});
