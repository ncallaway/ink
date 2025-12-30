import { Command } from "commander";
import * as fs from "fs/promises";
import * as path from "path";
import chalk from "chalk";
import ora from "ora";
import { lib, DiscId } from "@ink/shared";
import { loadPlan } from "../plan/utils";
import { loadMetadata } from "../metadata/utils";
import { formatDuration, calculateEta } from "./time";
import { 
    ensureDirs, 
    getExtractedPath, 
    getEncodedPath, 
    getStagingDir
} from "./utils";
import watcher from "@parcel/watcher";
import { platform } from "os";

export const runTranscode = (parent: Command) => {
  parent
    .command('transcode [disc-id]')
    .description('Process transcoding queue for extracted tracks (Continuous Loop)')
    .action(run);
}

function durationToSeconds(duration: string): number {
    const parts = duration.split(':').map(Number);
    if (parts.length === 3) {
        return parts[0] * 3600 + parts[1] * 60 + parts[2];
    }
    return 0;
}

let isProcessing = false;
let pendingTrigger = false;

async function run(targetDiscId?: string) {
    console.log(chalk.blue("Starting transcode loop... (Press Ctrl+C to exit)"));

    // 1. Setup Watchers
    const plansDir = lib.paths.plans();
    const stagingDir = lib.paths.staging();
    await fs.mkdir(plansDir, { recursive: true });
    await fs.mkdir(stagingDir, { recursive: true });

    const backends: Record<string, string> = {
        linux: 'inotify',
        darwin: 'fs-events',
        win32: 'windows'
    };
    const backend = backends[platform()] || undefined;

    const onEvent = () => {
        if (isProcessing) {
            pendingTrigger = true;
            return;
        }
        triggerCycle();
    };

    let debounceTimer: Timer | null = null;
    const triggerCycle = () => {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            runCycle(targetDiscId).catch(err => console.error(chalk.red("Cycle failed:"), err));
        }, 2000);
    };

    const plansSub = await watcher.subscribe(plansDir, onEvent, { backend });
    const stagingSub = await watcher.subscribe(stagingDir, onEvent, { backend });

    process.on('SIGINT', () => {
        console.log(chalk.yellow("\nStopping transcode loop..."));
        plansSub.unsubscribe();
        stagingSub.unsubscribe();
        process.exit(0);
    });

    // Initial run
    triggerCycle();
}

async function runCycle(targetDiscId?: string) {
    if (isProcessing) return;
    isProcessing = true;
    pendingTrigger = false;

    const stagingDir = getStagingDir();
    try {
        await fs.access(stagingDir);
    } catch {
        isProcessing = false;
        return;
    }

    try {
        let discDirs = await fs.readdir(stagingDir);

        if (targetDiscId) {
            if (!discDirs.includes(targetDiscId)) {
                console.log(chalk.red(`Disc ID ${targetDiscId} not found in staging.`));
                isProcessing = false;
                return;
            }
            discDirs = [targetDiscId];
        }

        let processedAny = false;

        for (const discIdStr of discDirs) {
            // Skip hidden files/dirs
            if (discIdStr.startsWith('.')) continue;
            const discId = discIdStr as DiscId;

            const plan = await loadPlan(discId);
            if (!plan) continue;

            const metadata = await loadMetadata(discId);
            
            // Find tracks that are extracted but not encoded
            for (const track of plan.tracks) {
                // Use standardized queue status check
                const statusRes = await lib.tracks.queueStatus(plan, track, 'transcode');
                if (statusRes.isErr() || statusRes.value !== 'ready') {
                    continue;
                }

                processedAny = true;
                
                const inputPath = getExtractedPath(discId, track.trackNumber);
                const outputPath = getEncodedPath(discId, track.trackNumber);
                
                await ensureDirs(discId);

                // Find duration for percentage
                let durationSeconds = 0;
                if (metadata) {
                    const metaTrack = metadata.tracks.find(t => t.trackNumber === track.trackNumber);
                    if (metaTrack) {
                        durationSeconds = durationToSeconds(metaTrack.duration);
                    }
                }

                console.log(chalk.blue(`\nTranscoding Track ${track.trackNumber} (${track.name})...`));
                const transcodeSpinner = ora('Initializing...').start();
                const start = Date.now();

                // MARKER: Running
                const rmRunningMarker = await lib.storage.writeTrackQueueMarker(
                    discId, track.trackNumber, 'transcode', 'running'
                );

                try {
                    // 1. Detect Crop
                    transcodeSpinner.text = 'Detecting auto-crop...';
                    const cropResult = await lib.ffmpeg.detectCrop(inputPath);
                    const crop = cropResult.isOk() ? cropResult.value : null;

                    if (crop) {
                        transcodeSpinner.info(`Auto-crop detected: ${crop}`);
                    }

                    // 2. Transcode
                    transcodeSpinner.start('Initializing ffmpeg...');

                    const result = await lib.ffmpeg.transcode(
                        inputPath, 
                        outputPath, 
                        durationSeconds,
                        {
                            codec: track.transcode?.codec || 'libx265',
                            preset: track.transcode?.preset || 'slow',
                            crf: track.transcode?.crf || 20,
                            audio: track.transcode?.audio || [],
                            subtitles: track.transcode?.subtitles || [],
                            crop: crop || undefined,
                            deinterlace: true // Always deinterlace for now (safe for progressive too via yadif)
                        },
                        (progress) => {
                            let text = "";
                            const elapsed = Date.now() - start;
                            
                            if (progress.percentage !== undefined) {
                                text += `${progress.percentage.toFixed(1)}% `;
                                const eta = calculateEta(start, progress.percentage);
                                text += `[Elapsed: ${formatDuration(elapsed)} ETA: ${eta}] `;
                            }
                            if (progress.time) {
                                text += `(${progress.time}) `;
                            }
                            if (progress.fps) {
                                text += `${progress.fps} fps `;
                            }
                            if (progress.speed) {
                                text += `${progress.speed}`;
                            }
                            transcodeSpinner.text = text.trim();
                        }
                    );

                    if (result.isErr()) {
                        transcodeSpinner.fail(`Transcoding failed: ${result.error.message}`);
                        continue;
                    }

                    transcodeSpinner.succeed('Transcoding complete.');

                    // Write Status
                    await lib.storage.writeTrackQueueMarker(
                        discId, track.trackNumber, 'transcode', 'done',
                        {
                            discId,
                            trackNumber: track.trackNumber,
                            timestamp: new Date().toISOString(),
                            durationMs: Date.now() - start,
                            codec: track.transcode?.codec || 'libx265',
                            crf: track.transcode?.crf || 22
                        }
                    );

                    console.log(chalk.green(`Track ${track.trackNumber} saved to ${outputPath}`));
                } catch (e) {
                    transcodeSpinner.fail(`Unexpected error: ${e}`);
                } finally {
                    await rmRunningMarker();
                }
            }
        }
    } finally {
        isProcessing = false;
        if (pendingTrigger) {
            runCycle(targetDiscId).catch(err => console.error(chalk.red("Follow-up cycle failed:"), err));
        }
    }
}

function durationToSeconds(duration: string): number {
    const parts = duration.split(':').map(Number);
    if (parts.length === 3) {
        return parts[0] * 3600 + parts[1] * 60 + parts[2];
    }
    return 0;
}
