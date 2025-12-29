import { err, ok, Result, ResultAsync } from "neverthrow";
import * as fs from "fs/promises";
import { paths } from "../paths";
import { DiscId, DiscMetadata } from "../types";
import { toError } from "../util";

const listAllPlanFiles = async (): Promise<Result<DiscId[], Error>> => {
  const plansDir = paths.plans();

  // Read directory directly
  const readRes = await ResultAsync.fromPromise(fs.readdir(plansDir), toError);
  
  if (readRes.isErr()) {
    // If directory is missing, return empty list
    if ((readRes.error as any).code === 'ENOENT') {
      return ok([]);
    }
    return err(readRes.error);
  }

  const planFiles = readRes.value;
  const planJsonFiles = planFiles.filter(f => f.endsWith('.json'));
  const planDiscIds = planJsonFiles.map(s => s.replace('.json', '')) as DiscId[];

  return ok(planDiscIds);
}

const listAllMetadataFiles = async (): Promise<Result<DiscId[], Error>> => {
  const metadataDir = paths.metadatas();

  // Read directory directly
  const readRes = await ResultAsync.fromPromise(fs.readdir(metadataDir), toError);

  if (readRes.isErr()) {
    // If directory is missing, return empty list
    if ((readRes.error as any).code === 'ENOENT') {
      return ok([]);
    }
    return err(readRes.error);
  }

  const metadataFiles = readRes.value;
  const metadataJsonFiles = metadataFiles.filter(f => f.endsWith('.json'));
  const metadataDiscIds = metadataJsonFiles.map(s => s.replace('.json', '')) as DiscId[];

  return ok(metadataDiscIds);
}

const readMetadata = async (discId: DiscId): Promise<Result<DiscMetadata, Error>> => {
  const readRes = await ResultAsync.fromPromise(fs.readFile(paths.metadata(discId), 'utf-8'), toError);

  if (readRes.isErr()) {
    return err(readRes.error);
  }

  return Result.fromThrowable(() => JSON.parse(readRes.value) as DiscMetadata, toError)();
}

export const storage = {
  listAllMetadataFiles,
  listAllPlanFiles,
  readMetadata
}
