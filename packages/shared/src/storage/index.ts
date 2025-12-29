import { err, ok, Result } from "neverthrow";
import * as fs from "fs/promises";
import { paths } from "../paths";
import { DiscId, DiscMetadata } from "../types";

const listAllPlanFiles = async (): Promise<Result<DiscId[], Error>> => {
  const plansDir = paths.plans();

  try {
    await fs.access(plansDir);
  } catch {
    return ok([]);
  }

  const planFiles = await fs.readdir(plansDir);
  const planJsonFiles = planFiles.filter(f => f.endsWith('.json'));
  const planDiscIds = planJsonFiles.map(s => s.replace('.json', '')) as DiscId[];

  return ok(planDiscIds);
}

const listAllMetadataFiles = async (): Promise<Result<DiscId[], Error>> => {
  const metadataDir = paths.metadatas();

  try {
    await fs.access(metadataDir);
  } catch {
    return ok([]);
  }

  const metadataFiles = await fs.readdir(metadataDir);
  const metadataJsonFiles = metadataFiles.filter(f => f.endsWith('.json'));
  const metadataDiscIds = metadataJsonFiles.map(s => s.replace('.json', '')) as DiscId[];

  return ok(metadataDiscIds);
}

const readMetadata = async (discId: DiscId): Promise<Result<DiscMetadata, Error>> => {
  try {
    const content = await fs.readFile(paths.metadata(discId), 'utf-8');
    const metadata = JSON.parse(content) as DiscMetadata;
    // todo: validate
    return ok(metadata);
  } catch (e) {
    return err(e);
  }
}

export const storage = {
  listAllMetadataFiles,
  listAllPlanFiles,
  readMetadata
}
