"use client";

import { createContext, useContext, useState } from "react";
import { useRouter } from "next/navigation";
import type { WorkspaceSettings } from "@/lib/types";

interface WorkspaceContextValue {
  ready: true;
  settings: WorkspaceSettings;
  reloadSettings: () => void;
  setLocalSettings: (s: WorkspaceSettings) => void;
}

const Ctx = createContext<WorkspaceContextValue | null>(null);

export function useWorkspace() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useWorkspace must be used inside WorkspaceProvider");
  return v;
}

export function WorkspaceProvider({
  initialSettings,
  children,
}: {
  initialSettings: WorkspaceSettings;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [settings, setSettings] = useState<WorkspaceSettings>(initialSettings);

  function reloadSettings() {
    router.refresh();
  }

  function setLocalSettings(s: WorkspaceSettings) {
    setSettings(s);
  }

  return (
    <Ctx.Provider value={{ ready: true, settings, reloadSettings, setLocalSettings }}>
      {children}
    </Ctx.Provider>
  );
}
