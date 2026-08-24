import { serverRepositories } from "@/lib/repositories/server";
import { createDefaultSettings } from "@/lib/workspace/defaults";
import { SettingsView } from "./SettingsView";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const { repos } = await serverRepositories();
  const [settings, assets] = await Promise.all([repos.settings.get(), repos.assets.list()]);
  const effective = settings ?? { ...createDefaultSettings(), onboardingComplete: true };
  return <SettingsView initialSettings={effective} initialAssets={assets} />;
}
