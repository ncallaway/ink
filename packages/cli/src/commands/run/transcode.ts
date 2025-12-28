import { Command } from "commander";
import * as fs from "fs/promises";
import * as path from "path";
import chalk from "chalk";
import ora from "ora";
import { lib } from "@ink/shared";
import { loadPlan } from "../plan/utils";
import { loadMetadata } from "../metadata/utils";
import { formatDuration, calculateEta } from "./time";
import { 
    ensureDirs, 
    getExtractedPath, 
    getEncodedPath, 
    getExtractedStatusPath, 
    getEncodedStatusPath, 
    hasStatus, 
    writeStatus,
    getStagingDir
} from "./utils";

export const runTranscode = (parent: Command) => {
  parent
    .command('transcode [disc-id]')
    .description('Process transcoding queue for extracted tracks')
    .action(run);
}

async function run(targetDiscId?: string) {
    const stagingDir = getStagingDir();
    try {
        await fs.access(stagingDir);
    } catch {
        console.log("No staging directory found. Run 'extract' first.");
        return;
    }

    let discDirs = await fs.readdir(stagingDir);

    if (targetDiscId) {
        if (!discDirs.includes(targetDiscId)) {
             console.log(chalk.red(`Disc ID ${targetDiscId} not found in staging.`));
             return;
        }
        discDirs = [targetDiscId];
    }

    let processedAny = false;

    for (const discId of discDirs) {
        // Skip hidden files/dirs
        if (discId.startsWith('.')) continue;

        const plan = await loadPlan(discId);
        if (!plan) continue;

        const metadata = await loadMetadata(discId);
        
        // Find tracks that are extracted but not encoded
        for (const track of plan.tracks) {
            const extractedStatus = getExtractedStatusPath(discId, track.trackNumber);
            const encodedStatus = getEncodedStatusPath(discId, track.trackNumber);

            if (await hasStatus(extractedStatus) && !(await hasStatus(encodedStatus))) {
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
                await writeStatus(encodedStatus, {
                    discId,
                    trackNumber: track.trackNumber,
                    timestamp: new Date().toISOString(),
                    durationMs: Date.now() - start,
                    codec: track.transcode?.codec || 'libx265',
                    crf: track.transcode?.crf || 22
                });

                console.log(chalk.green(`Track ${track.trackNumber} saved to ${outputPath}`));
            }
        }
    }

    if (!processedAny) {
        console.log("No pending transcodes found in staging.");
    }
}

function durationToSeconds(duration: string): number {
    const parts = duration.split(':').map(Number);
    if (parts.length === 3) {
        return parts[0] * 3600 + parts[1] * 60 + parts[2];
    }
    return 0;
}
