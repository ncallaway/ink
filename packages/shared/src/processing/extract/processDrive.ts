import * as path from "path";
import * as fs from "fs/promises";
import {Ora} from "ora";
import { BackupPlan, DevicePath, DiscId, DriveStatus, TrackPlan } from "../../types";
import { drive as libDrive } from "../../drive";
import { disc as libDisc } from "../../disc";
import { metadata as libMetadata } from "../../metadata";
import { storage as libStorage } from "../../storage";
import { makemkv } from "../../makemkv";
import { paths } from "../../paths";
import { MetadataPromptFn } from "../../metadata/readFromDisc";
import { err, ok, Result } from "neverthrow";
import { fmt } from "../../fmt";

export type ProcessDriveOptions = {
  spinner?: Ora
};

export const processDrive = async (device: DevicePath, namePrompt: MetadataPromptFn, options: ProcessDriveOptions = {}): Promise<Result<boolean, Error>> => {
  const {spinner} = options;
  spinner?.start(`Checking drive ${device}...`);

  // Check Status
  const statusResult = libDrive.status(device);
  if (statusResult.isErr() || statusResult.value !== DriveStatus.DISK_PRESENT) {
    return ok(false);
  }

  // Identify Disc
  const idResult = await libDisc.identify(device);
  if (idResult.isErr()) {
    spinner?.fail(`Could not identify disc in ${device}: ${idResult.error.message}`);
    return err(new Error(`Could not identify disc in ${device}: ${idResult.error.message}`, idResult.error));
  }
  const discId = idResult.value;

  // Load Plan
  const planRes = await libStorage.readPlan(discId);
  let plan: BackupPlan | null = null;
  if (planRes.isErr()) {
    // ENOENT just means we don't have a plan, so we'll let it be null
    if ((planRes.error as any).code !== 'ENOENT') {
      spinner?.fail(`Failed to load plan for disc ${discId}${device}: ${planRes.error.message}`);
      return err(new Error(`Could not identify disc in ${device}: ${planRes.error.message}`, planRes.error));
    }
  } else {
    plan = planRes.value;
  }

  if (!plan) {
    const metadata = (await libStorage.readMetadata(discId)).unwrapOr(null);

    if (!metadata) {
      spinner?.info(`No metadata for disc ${discId} in drive ${device}.`);
      const res = await libMetadata.readFromDisc(device, namePrompt, { spinner, discId });
      if (res.isErr()) {
        return err(new Error(`Could not read metadata for disc in ${device}: ${res.error.message}`, res.error));
      }
      return ok(true);
    } else {
      spinner?.info(`No plan exists for disc ${discId} in drive ${device}. Skipping.`);
      return ok(false);
    }
  }

  spinner?.succeed(`Found plan for disc ${discId} (${plan.title})`);

  // Find MakeMKV Index
  const indexResult = await makemkv.findDriveIndex(device);
  if (indexResult.isErr()) {
    spinner?.fail(`Could not map ${device} to MakeMKV: ${indexResult.error.message}`);
    return err(new Error(`Could not map ${device} to MakeMKV: ${indexResult.error.message}`, indexResult.error));
  }

  const driveIndex = indexResult.value;

  await libStorage.ensureStagingDirectories(discId);

  // Process Tracks
  for (const track of plan.tracks) {
    try {
      await processTrack(device, discId, driveIndex, track, spinner);
    } catch(err: any) {
      console.error(`Unexpected error processing track ${track.trackNumber}:`, err);
      // swallow-errors, as we want to try to process other tracks, and we'll
      // already have logged and recorded the track error.
    }
  }

  return ok(true);
}

const processTrack = async (device: DevicePath, discId: DiscId, driveIndex: number, track: TrackPlan, spinner?: Ora) => {
  if (!track.extract) { return };

  const statusPath = paths.discStaging.markers.extractedDone(discId, track.trackNumber);
  if (await libStorage.markerPresent(statusPath)) {
    return;
  }

  spinner?.info(`Extracting Track ${track.trackNumber} (Title ${track.name})...`);

  // create 'running' file marker
  const rmRunningMarker = await libStorage.writeTrackQueueMarker(
    discId, track.trackNumber, 'extract', 'running'
  );

  // Create isolated temp dir for this track to handle random filenames
  const tempDir = path.join(paths.discStaging.extracted(discId), `temp_${track.trackNumber}`);
  await fs.mkdir(tempDir, { recursive: true });

  spinner?.start('Initializing MakeMKV');
  const start = Date.now();

  let lastStage = '';
  const ignoredStages = ['Scanning CD-ROM devices', 'Processing title sets', 'Processing titles', 'Opening DVD disc'];

  const result = await makemkv.extractTitle(driveIndex, track.trackNumber, tempDir, (progress) => {
    const stage = progress.message || lastStage;
    if (!stage) return;

    if (ignoredStages.includes(stage) && spinner) {
      spinner.text = `${stage}...`;
      return;
    }

    if (stage !== lastStage && spinner) {
      if (lastStage && !ignoredStages.includes(lastStage)) {
        spinner.succeed(`${lastStage}`);
        spinner.start(stage);
      } else {
        // Transitioning from ignored/start to valid stage
        spinner.text = stage;
      }
      lastStage = stage;
    }

    if (progress.percentage !== undefined && spinner) {
      const elapsed = Date.now() - start;
      const eta = fmt.eta(start, progress.percentage);
      spinner.text = `${stage} ${progress.percentage.toFixed(1)}% [Elapsed: ${fmt.duration(elapsed)} ETA: ${eta}]`;
    }
  });

  if (result.isErr()) {
    spinner?.fail(`Extraction failed: ${result.error.message}`);
    console.error(`Detailed error for Track ${track.trackNumber}:`);
    console.error(result.error.message);

    await libStorage.writeTrackQueueError(discId, track.trackNumber, 'extract', [result.error]);
    // Cleanup
    await fs.rm(tempDir, { recursive: true, force: true });
    // remove running marker
    await rmRunningMarker();
    return;
  }

  spinner?.succeed('Extraction complete.');

  // Find the file
  const files = await fs.readdir(tempDir);
  const mkvFile = files.find(f => f.endsWith('.mkv'));

  if (!mkvFile) {
    spinner?.fail("No MKV file found after extraction.");
    console.error("No MKV file found after extraction.");
    await libStorage.writeTrackQueueError(discId, track.trackNumber, 'extract', ["No MKV file found after extraction."]);
    await fs.rm(tempDir, { recursive: true, force: true });
    // remove running marker
    await rmRunningMarker();
    return;
  }

  // Move to final location
  const finalPath = paths.discStaging.extractedVideo(discId, track.trackNumber);
  await fs.rename(path.join(tempDir, mkvFile), finalPath);
  await fs.rm(tempDir, { recursive: true, force: true });
  await libStorage.removeTrackQueueError(discId, track.trackNumber, 'extract');
  await rmRunningMarker();

  // Write Status
  await libStorage.writeTrackQueueMarker(
    discId, track.trackNumber, 'extract', 'done',
    {
      discId,
      trackNumber: track.trackNumber,
      timestamp: new Date().toISOString(),
      sourceDrive: device,
      durationMs: Date.now() - start
    }
  );

  spinner?.succeed(`Track ${track.trackNumber} saved to ${finalPath}`);
}
