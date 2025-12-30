import { err, ok, Result, ResultAsync } from "neverthrow";
import * as fs from "fs/promises";
import { paths } from "../paths";
import { BackupPlan, DiscId, DiscMetadata, TrackNumber, TrackQueue } from "../types";
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

const saveMetadata = async (discId: DiscId, metadata: DiscMetadata) => {
  await fs.mkdir(paths.metadatas(), { recursive: true });
  await fs.writeFile(paths.metadata(discId), JSON.stringify(metadata, null, 2));
}

const readPlan = async (discId: DiscId): Promise<Result<BackupPlan, Error>> => {
  const readRes = await ResultAsync.fromPromise(fs.readFile(paths.plan(discId), 'utf-8'), toError);

  if (readRes.isErr()) {
    return err(readRes.error);
  }

  return Result.fromThrowable(() => JSON.parse(readRes.value) as BackupPlan, toError)();
}

const writeTrackQueueMarker = async (discId: DiscId, track: TrackNumber, queue: TrackQueue, marker: 'done' | 'running' | 'ignored', data?: any) => {
  const path = trackQueueMarkerPath(discId, track, queue, marker);

  const markerFile = await fs.open(path, 'w', 'utf-8');
  if (data) {
    await markerFile.write(JSON.stringify(data, null, 2));
  }
  await markerFile.close();

  return () => removeMarker(path);
}

const removeMarker = async (path: string) => {
  await fs.rm(path, { force: true });
}


const markerPresent = async (path: string): Promise<boolean> => {
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
}

const ensureStagingDirectories = async (discId: DiscId) => {
  await fs.mkdir(paths.discStaging.extracted(discId), { recursive: true });
  await fs.mkdir(paths.discStaging.encoded(discId), { recursive: true });
  await fs.mkdir(paths.discStaging.reviewed(discId), { recursive: true });
  await fs.mkdir(paths.discStaging.copied(discId), { recursive: true });
}

const trackQueueMarkerPath = (discId: DiscId, track: TrackNumber, queue: TrackQueue, marker: 'done' | 'running' | 'ignored') => {
  switch(marker) {
    case 'done': {
      switch(queue) {
        case 'extract': return paths.discStaging.markers.extractedDone(discId, track);
        case 'transcode': return paths.discStaging.markers.encodedDone(discId, track);
        case 'review': return paths.discStaging.markers.reviewedDone(discId, track);
        case 'copy': return paths.discStaging.markers.copiedDone(discId, track);
      }
    }
    case 'running': {
      switch(queue) {
        case 'extract': return paths.discStaging.markers.extractedRunning(discId, track);
        case 'transcode': return paths.discStaging.markers.encodedRunning(discId, track);
        case 'review': return paths.discStaging.markers.reviewedRunning(discId, track);
        case 'copy': return paths.discStaging.markers.copiedRunning(discId, track);
      }
    }
    case 'ignored': {
      switch(queue) {
        case 'review': return paths.discStaging.markers.reviewedIgnored(discId, track);
        default: throw new Error("Not supported");
      }
    }
  }
}

const trackQueueErrorPath = (discId: DiscId, track: TrackNumber, queue: TrackQueue) => {
  switch(queue) {
    case 'extract': return paths.discStaging.errors.extracted(discId, track);
    case 'transcode': return paths.discStaging.errors.encoded(discId, track);
    case 'review': return paths.discStaging.errors.reviewed(discId, track);
    case 'copy': return paths.discStaging.errors.copied(discId, track);
  }
}

const writeTrackQueueError = async (discId: DiscId, track: TrackNumber, queue: TrackQueue, errors: any[]) => {
  const path = trackQueueErrorPath(discId, track, queue);

  const errFile = await fs.open(path, 'w', 'utf-8');
  await errFile.write(JSON.stringify({ errors }));
  await errFile.close();
}

const removeTrackQueueError = async (discId: DiscId, track: TrackNumber, queue: TrackQueue) => {
  const path = trackQueueErrorPath(discId, track, queue);

  await fs.rm(path, { force: true });
}

export const storage = {
  listAllMetadataFiles,
  listAllPlanFiles,
  readMetadata,
  readPlan,
  saveMetadata,
  markerPresent,
  ensureStagingDirectories,

  writeTrackQueueMarker,
  writeTrackQueueError,
  removeTrackQueueError,
}
