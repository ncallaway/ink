import { Command } from "commander";
import * as fs from "fs/promises";
import * as path from "path";
import chalk from "chalk";
import ora from "ora";
import { lib, DriveStatus, DevicePath } from "@ink/shared";
import { loadPlan } from "../plan/utils";
import { ensureDirs, getExtractedDir, getExtractedPath, getExtractedStatusPath, hasStatus, writeStatus } from "./utils";

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
            spinner.info(`Disc ${discId} found, but no plan exists. Skipping.`);
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

            const statusPath = getExtractedStatusPath(discId, track.trackNumber);
            if (await hasStatus(statusPath)) {
                // Already extracted
                continue;
            }

            processedAny = true;
            console.log(chalk.blue(`Extracting Track ${track.trackNumber} (Title ${track.name})...`));
            
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
                    // Update text but don't persist/notify stage change for ignored ones
                    // actually, maybe we just ignore them entirely to keep the spinner on the previous "real" task or "Initializing..."
                    // If we ignore them, we might be stuck on "Initializing..." for a while.
                    // Let's show them but not persist them?
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
                    extractSpinner.text = `${stage} ${progress.percentage.toFixed(1)}%`;
                }
            });
            
            if (result.isErr()) {
                extractSpinner.fail(`Extraction failed: ${result.error.message}`);
                // Cleanup
                await fs.rm(tempDir, { recursive: true, force: true });
                continue; // Try next track? Or abort? Abort for now to be safe.
                // Actually, continue is better for resilience.
            }

            extractSpinner.succeed('Extraction complete.');

            // Find the file
            const files = await fs.readdir(tempDir);
            const mkvFile = files.find(f => f.endsWith('.mkv'));

            if (!mkvFile) {
                console.error(chalk.red("No MKV file found after extraction."));
                await fs.rm(tempDir, { recursive: true, force: true });
                continue;
            }

            // Move to final location
            const finalPath = getExtractedPath(discId, track.trackNumber);
            await fs.rename(path.join(tempDir, mkvFile), finalPath);
            await fs.rm(tempDir, { recursive: true, force: true });

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
