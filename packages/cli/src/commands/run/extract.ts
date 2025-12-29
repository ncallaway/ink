import { Command } from "commander";
import * as fs from "fs/promises";
import * as path from "path";
import chalk from "chalk";
import ora from "ora";
import { lib, DriveStatus, DevicePath } from "@ink/shared";
import { loadPlan } from "../plan/utils";
import { formatDuration, calculateEta } from "./time";
import { ensureDirs, getExtractedDir, getExtractedPath, getExtractedStatusPath, hasStatus, writeStatus } from "./utils";
import { loadMetadata } from "../metadata/utils";

export const runExtract = (parent: Command) => {
  parent
    .command('extract')
    .description('Process extraction queue for inserted discs')
    .action(run);
}

async function run() {
  const spinner = ora('Checking drives...').start();

  // 1. List Drives
  const drivesResult = lib.drive.list();
  if (drivesResult.isErr()) {
    spinner.fail(`Error listing drives: ${drivesResult.error.message}`);
    return;
  }

  const drives = drivesResult.value;
  if (drives.length === 0) {
    spinner.info('No drives found.');
    return;
  }

  let processedAny = false;

  for (const drive of drives) {
    spinner.text = `Checking drive ${drive}...`;

    // Check Status
    const statusResult = lib.drive.status(drive);
    if (statusResult.isErr() || statusResult.value !== DriveStatus.DISK_PRESENT) {
      continue;
    }

    // Identify Disc
    const idResult = await lib.disc.identify(drive as unknown as DevicePath);
    if (idResult.isErr()) {
      spinner.warn(`Could not identify disc in ${drive}: ${idResult.error.message}`);
      continue;
    }
    const discId = idResult.value;

    // Load Plan
    const plan = await loadPlan(discId);
    if (!plan) {

      const metadata = (await lib.storage.readMetadata(discId)).unwrapOr(null);

      if (!metadata) {
        spinner.info(`No metadata for disc ${discId} in drive ${drive}.`);
        await lib.metadata.readFromDisc(drive, { spinner, discId });
      } else {
        spinner.info(`No plan exists for disc ${discId} in drive ${drive}. Skipping.`);
      }
      continue;
    }

    spinner.succeed(`Found plan for ${chalk.bold(plan.title)} (${discId})`);

    // Find MakeMKV Index
    const indexResult = await lib.makemkv.findDriveIndex(drive);
    if (indexResult.isErr()) {
      console.error(chalk.red(`Could not map ${drive} to MakeMKV: ${indexResult.error.message}`));
      continue;
    }
    const driveIndex = indexResult.value;

    await ensureDirs(discId);

    // Process Tracks
    for (const track of plan.tracks) {
      if (!track.extract) continue;

      const statusPath = lib.paths.discStaging.markers.extractedDone(discId, track.trackNumber);
      if (await hasStatus(statusPath)) {
        // Already extracted
        continue;
      }

      processedAny = true;
      console.log(chalk.blue(`Extracting Track ${track.trackNumber} (Title ${track.name})...`));

      // create 'running' file marker
      const runningFile = await fs.open(lib.paths.discStaging.markers.extractedRunning(discId, track.trackNumber), 'a');
      await runningFile.close();

      // Create isolated temp dir for this track to handle random filenames
      const tempDir = path.join(getExtractedDir(discId), `temp_${track.trackNumber}`);
      await fs.mkdir(tempDir, { recursive: true });

      const extractSpinner = ora('Initializing MakeMKV...').start();
      const start = Date.now();

      let lastStage = '';
      const ignoredStages = ['Scanning CD-ROM devices', 'Processing title sets', 'Processing titles', 'Opening DVD disc'];

      const result = await lib.makemkv.extractTitle(driveIndex, track.trackNumber, tempDir, (progress) => {
        const stage = progress.message || lastStage;
        if (!stage) return;

        if (ignoredStages.includes(stage)) {
          extractSpinner.text = `${stage}...`;
          return;
        }

        if (stage !== lastStage) {
          if (lastStage && !ignoredStages.includes(lastStage)) {
            extractSpinner.succeed(`${lastStage}`);
            extractSpinner.start(stage);
          } else {
            // Transitioning from ignored/start to valid stage
            extractSpinner.text = stage;
          }
          lastStage = stage;
        }

        if (progress.percentage !== undefined) {
          const elapsed = Date.now() - start;
          const eta = calculateEta(start, progress.percentage);
          extractSpinner.text = `${stage} ${progress.percentage.toFixed(1)}% [Elapsed: ${formatDuration(elapsed)} ETA: ${eta}]`;
        }
      });

      if (result.isErr()) {
        extractSpinner.fail(`Extraction failed: ${result.error.message}`);
        console.error(chalk.red(`\nDetailed error for Track ${track.trackNumber}:`));
        console.error(result.error.message);
        const errFile = await fs.open(lib.paths.discStaging.errors.extracted(discId, track.trackNumber), 'w', 'utf-8');
        await errFile.write(JSON.stringify({ errors: [result.error]}));
        await errFile.close();
        // Cleanup
        await fs.rm(tempDir, { recursive: true, force: true });
        // remove running marker
        await fs.rm(lib.paths.discStaging.markers.extractedRunning(discId, track.trackNumber), { force: true });
        continue;
      }

      extractSpinner.succeed('Extraction complete.');

      // Find the file
      const files = await fs.readdir(tempDir);
      const mkvFile = files.find(f => f.endsWith('.mkv'));

      if (!mkvFile) {
        console.error(chalk.red("No MKV file found after extraction."));
        const errFile = await fs.open(lib.paths.discStaging.errors.extracted(discId, track.trackNumber), 'w', 'utf-8');
        await errFile.write(JSON.stringify({ errors: ["No MKV file found after extraction."]}));
        await errFile.close();
        await fs.rm(tempDir, { recursive: true, force: true });
        // remove running marker
        await fs.rm(lib.paths.discStaging.markers.extractedRunning(discId, track.trackNumber), { force: true });
        continue;
      }

      // Move to final location
      const finalPath = getExtractedPath(discId, track.trackNumber);
      await fs.rename(path.join(tempDir, mkvFile), finalPath);
      await fs.rm(tempDir, { recursive: true, force: true });
      await fs.rm(lib.paths.discStaging.markers.extractedRunning(discId, track.trackNumber), { force: true });

      // Write Status
      await writeStatus(statusPath, {
        discId,
        trackNumber: track.trackNumber,
        timestamp: new Date().toISOString(),
        sourceDrive: drive,
        durationMs: Date.now() - start
      });

      console.log(chalk.green(`Track ${track.trackNumber} saved to ${finalPath}`));
    }
  }

  if (!processedAny) {
    console.log("No pending extractions found for inserted discs.");
  }
}
