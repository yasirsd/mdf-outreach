import type { SupabaseClient } from "@supabase/supabase-js";
import { canTransitionStage, type BuyerFinderSearchRun, type SearchRunPatch } from "@/lib/buyerFinder/searchRun";
import { isEntityUuid } from "@/lib/buyerFinder/ids";
import type {
  BuyerFinderSearchRunCreateInput,
  BuyerFinderSearchRunRepository,
} from "../interfaces";
import { SearchRunActiveExistsError } from "../interfaces";
import {
  searchRunFromRow,
  searchRunToInsertRow,
  searchRunToPatchRow,
  type BuyerFinderSearchRunRow,
} from "./searchRunMappers";

function isUniqueViolation(error: { code?: string } | null): boolean {
  return error?.code === "23505";
}

export class SupabaseBuyerFinderSearchRunRepository implements BuyerFinderSearchRunRepository {
  constructor(
    private supabase: SupabaseClient,
    private workspaceId: string,
  ) {}

  async create(input: BuyerFinderSearchRunCreateInput): Promise<BuyerFinderSearchRun> {
    const row = searchRunToInsertRow(input, this.workspaceId);
    const { data, error } = await this.supabase
      .from("buyer_finder_search_runs")
      .insert(row)
      .select("*")
      .single();
    if (error) {
      if (isUniqueViolation(error)) throw new SearchRunActiveExistsError();
      throw error;
    }
    return searchRunFromRow(data as BuyerFinderSearchRunRow);
  }

  async get(id: string): Promise<BuyerFinderSearchRun | undefined> {
    if (!isEntityUuid(id)) return undefined;
    const { data, error } = await this.supabase
      .from("buyer_finder_search_runs")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    return data ? searchRunFromRow(data as BuyerFinderSearchRunRow) : undefined;
  }

  async update(id: string, patch: SearchRunPatch): Promise<BuyerFinderSearchRun> {
    if (!isEntityUuid(id)) throw new Error("Invalid search run id");
    const safe = await this.guardStage(id, patch);
    const fields = searchRunToPatchRow(safe);
    const { data, error } = await this.supabase
      .from("buyer_finder_search_runs")
      .update(fields)
      .eq("id", id)
      .select("*")
      .single();
    if (error) throw error;
    return searchRunFromRow(data as BuyerFinderSearchRunRow);
  }

  async getLatestActive(): Promise<BuyerFinderSearchRun | undefined> {
    const { data, error } = await this.supabase
      .from("buyer_finder_search_runs")
      .select("*")
      .in("status", ["queued", "running"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return data ? searchRunFromRow(data as BuyerFinderSearchRunRow) : undefined;
  }

  /**
   * Single-statement claim: UPDATE … WHERE id = $id AND status = 'queued'
   * RETURNING *. A second concurrent request sees zero rows.
   */
  async claimQueued(id: string): Promise<BuyerFinderSearchRun | undefined> {
    if (!isEntityUuid(id)) return undefined;
    const startedAt = new Date().toISOString();
    const { data, error } = await this.supabase
      .from("buyer_finder_search_runs")
      .update({
        status: "running",
        stage: "preparing",
        started_at: startedAt,
      })
      .eq("id", id)
      .eq("status", "queued")
      .select("*")
      .maybeSingle();
    if (error) throw error;
    return data ? searchRunFromRow(data as BuyerFinderSearchRunRow) : undefined;
  }

  private async guardStage(id: string, patch: SearchRunPatch): Promise<SearchRunPatch> {
    if (!patch.stage) return patch;
    const current = await this.get(id);
    if (!current) return patch;
    if (!canTransitionStage(current.stage, patch.stage)) {
      const { stage: _ignored, ...rest } = patch;
      return rest;
    }
    return patch;
  }
}

export function createBuyerFinderSearchRunRepository(
  supabase: SupabaseClient,
  workspaceId: string,
): BuyerFinderSearchRunRepository {
  return new SupabaseBuyerFinderSearchRunRepository(supabase, workspaceId);
}
