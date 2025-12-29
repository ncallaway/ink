import { err, ok, Result } from "neverthrow";
import { DiscId } from "../types";
import { storage } from "../storage";

export const pending = async (): Promise<Result<DiscId[], Error>> => {
  const metadataRes = await storage.listAllMetadataFiles();
  const planRes = await storage.listAllPlanFiles();

  if (metadataRes.isErr()) {
    return err(new Error("Error reading metadata files", metadataRes.error));
  }
  if (planRes.isErr()) {
    return err(new Error("Error reading plan files", planRes.error));
  }

  const metadataSet = new Set(metadataRes.value);
  const planSet = new Set(planRes.value);

  const pending = metadataSet.difference(planSet);

  return ok([...pending]);
}
