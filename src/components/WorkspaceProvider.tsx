"use client";

import { createContext, useContext, useState } from "react";
import type { WorkspaceSettings } from "@/lib/types";

interface WorkspaceContextValue {
  ready: true;
  settings: WorkspaceSettings;
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
  const [settings, setSettings] = useState<WorkspaceSettings>(initialSettings);

  function setLocalSettings(s: WorkspaceSettings) {
    setSettings(s);
  }

  return (
    <Ctx.Provider value={{ ready: true, settings, setLocalSettings }}>
      {children}
    </Ctx.Provider>
  );
}
