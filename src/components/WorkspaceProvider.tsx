"use client";

import { createContext, useContext, useEffect, useState } from "react";
import {
  activityRepo,
  assetRepo,
  buyerRepo,
  campaignRepo,
  recipientRepo,
  settingsRepo,
  templateRepo,
} from "@/lib/repositories";
import { buildDemoWorkspace, buildEmptyWorkspace, createDefaultSettings } from "@/lib/demo";
import type { WorkspaceSettings } from "@/lib/types";

interface WorkspaceContextValue {
  ready: boolean;
  settings: WorkspaceSettings | null;
  reloadSettings: () => Promise<void>;
  seedDemo: () => Promise<void>;
  seedEmpty: () => Promise<void>;
}

const Ctx = createContext<WorkspaceContextValue | null>(null);

export function useWorkspace() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useWorkspace must be used inside WorkspaceProvider");
  return v;
}

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [settings, setSettings] = useState<WorkspaceSettings | null>(null);

  async function reloadSettings() {
    const s = await settingsRepo.get();
    setSettings(s ?? null);
  }

  async function seedDemo() {
    const w = buildDemoWorkspace();
    await settingsRepo.put(w.settings);
    await templateRepo.bulkPut([w.template]);
    await buyerRepo.bulkPut(w.buyers);
    await campaignRepo.bulkPut([w.campaign]);
    await recipientRepo.bulkPut(w.recipients);
    await assetRepo.bulkPut(w.assets);
    await activityRepo.bulkPut(w.activity);
    await reloadSettings();
  }

  async function seedEmpty() {
    const w = buildEmptyWorkspace();
    await settingsRepo.put(w.settings);
    await templateRepo.bulkPut([w.template]);
    await campaignRepo.bulkPut([w.campaign]);
    await assetRepo.bulkPut(w.assets);
    await reloadSettings();
  }

  useEffect(() => {
    (async () => {
      let s = await settingsRepo.get();
      if (!s) {
        // Initialize settings shell without marking onboarding complete
        s = createDefaultSettings();
        await settingsRepo.put(s);
      }
      setSettings(s);
      setReady(true);
    })();
  }, []);

  return (
    <Ctx.Provider value={{ ready, settings, reloadSettings, seedDemo, seedEmpty }}>
      {children}
    </Ctx.Provider>
  );
}
