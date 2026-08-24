import { activityRepo } from "@/lib/repositories";
import { uid } from "@/lib/utils";

export async function logActivity(
  kind: string,
  message: string,
  entity?: { type: string; id: string },
) {
  await activityRepo.add({
    id: uid("act"),
    at: new Date().toISOString(),
    kind,
    message,
    entity,
  });
}
