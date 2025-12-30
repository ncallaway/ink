import { Command } from "commander";
import * as path from "path";
import chalk from "chalk";
import ora from "ora";
import { exec } from "child_process";
import { promisify } from "util";
import { lib, DiscId } from "@ink/shared";
import { loadPlan } from "../plan/utils";
import { 
    getStagingDir,
    getEncodedPath, 
    getReviewedStatusPath
} from "./utils";
import * as fs from "fs/promises";
import watcher from "@parcel/watcher";
import { platform } from "os";

export const runCopy = (parent: Command) => {
  parent
    .command('copy')
    .description('Process copy queue for finalized tracks (Continuous Loop)')
    .action(run);
}

function sanitizeRemotePath(p: string): string {
    // SMB/Windows illegal characters: \ / : * ? " < > |
    // We keep / as it's our path separator for the remote command, 
    // but we should sanitize individual components.
    return p.replace(/[:*?"<>|]/g, '-');
}

let isProcessing = false;
let pendingTrigger = false;

async function run() {
    console.log(chalk.blue("Starting copy loop... (Press Ctrl+C to exit)"));

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
            runCycle().catch(err => console.error(chalk.red("Cycle failed:"), err));
        }, 1000);
    };

    const plansSub = await watcher.subscribe(plansDir, onEvent, { backend });
    const stagingSub = await watcher.subscribe(stagingDir, onEvent, { backend });

    process.on('SIGINT', () => {
        console.log(chalk.yellow("\nStopping copy loop..."));
        plansSub.unsubscribe();
        stagingSub.unsubscribe();
        process.exit(0);
    });

    // Initial run
    triggerCycle();
}

async function runCycle() {
    if (isProcessing) return;
    isProcessing = true;
    pendingTrigger = false;

    const execAsync = promisify(exec);
    const stagingDir = getStagingDir();
    const smbTarget = process.env.SMB_TARGET || 'smb://192.168.1.200/storage/media';
    const smbUser = process.env.SMB_USER || 'user';
    const smbPass = process.env.SMB_PASSWORD || 'password';

    // Parse SMB Target
    const match = smbTarget.match(/^smb:\/\/([^\/]+)\/([^\/]+)(.*)$/);
    if (!match) {
        console.error("Invalid SMB_TARGET format. Expected smb://host/share/path");
        isProcessing = false;
        return;
    }
    const [, host, share, prefixPath] = match;

    try {
        const discDirs = await fs.readdir(stagingDir);
        let processedAny = false;

        for (const discIdStr of discDirs) {
            if (discIdStr.startsWith('.')) continue;
            const discId = discIdStr as DiscId;

            const plan = await loadPlan(discId);
            if (!plan) continue;

            for (const track of plan.tracks) {
                // Use the standardized queue status check
                const statusRes = await lib.tracks.queueStatus(plan, track, 'copy');
                if (statusRes.isErr() || statusRes.value !== 'ready') {
                    continue;
                }

                processedAny = true;
                const localPath = getEncodedPath(discId, track.trackNumber);
                
                // Determine remote path
                let suffix = track.output.directory;
                if (path.isAbsolute(suffix)) {
                    const typeDir = plan.type === 'tv' ? 'series' : 'movies';
                    suffix = path.join(typeDir, plan.title);
                }

                let remoteFilename = track.output.filename;
                
                // Check for reviewed name
                const reviewedDonePath = lib.paths.discStaging.markers.reviewedDone(discId, track.trackNumber);
                if (await lib.storage.markerPresent(reviewedDonePath)) {
                    try {
                        const reviewedStatusPath = getReviewedStatusPath(discId, track.trackNumber);
                        const reviewedContent = await fs.readFile(reviewedStatusPath, 'utf-8');
                        const reviewedData = JSON.parse(reviewedContent);
                        if (reviewedData.finalName) {
                            remoteFilename = reviewedData.finalName;
                        }
                    } catch {}
                }

                const sourceExt = path.extname(localPath);
                if (!path.extname(remoteFilename)) {
                    remoteFilename += sourceExt;
                }

                const cleanPrefix = prefixPath.replace(/^\//, '').replace(/\/$/, '');
                const cleanSuffix = suffix.replace(/^\//, '');
                
                const remoteDir = sanitizeRemotePath(path.join(cleanPrefix, cleanSuffix).replace(/\\/g, '/'));
                const remoteFilenameSanitized = sanitizeRemotePath(remoteFilename);
                const remotePath = path.join(remoteDir, remoteFilenameSanitized).replace(/\\/g, '/');

                console.log(chalk.blue(`\n[Track ${track.trackNumber}] ${track.name}`));
                
                const smbCommandString = `mkdir "${remoteDir}"; put "${localPath}" "${remotePath}"`.replace(/'/g, "'\\''");
                const cmd = `smbclient '//${host}/${share}' -U '${smbUser}%${smbPass}' -c '${smbCommandString}'`;
                
                const spinner = ora(`Copying to ${smbTarget}/${remotePath}...`).start();
                
                const rmRunningMarker = await lib.storage.writeTrackQueueMarker(
                    discId, track.trackNumber, 'copy', 'running'
                );

                try {
                    await execAsync(cmd);
                    spinner.succeed("Copy complete.");

                    await lib.storage.writeTrackQueueMarker(
                        discId, track.trackNumber, 'copy', 'done',
                        {
                            discId,
                            trackNumber: track.trackNumber,
                            timestamp: new Date().toISOString(),
                            destination: `smb://${host}/${share}/${remotePath}`
                        }
                    );
                } catch (e: any) {
                    spinner.text = "Retrying copy without mkdir...";
                    try {
                         const cmdRetry = `smbclient '//${host}/${share}' -U '${smbUser}%${smbPass}' -c 'put "${localPath}" "${remotePath}"'`;
                         await execAsync(cmdRetry);
                         spinner.succeed("Copy complete (Retry).");
                         
                         await lib.storage.writeTrackQueueMarker(
                            discId, track.trackNumber, 'copy', 'done',
                            {
                                discId,
                                trackNumber: track.trackNumber,
                                timestamp: new Date().toISOString(),
                                destination: `smb://${host}/${share}/${remotePath}`
                            }
                        );
                    } catch (retryErr: any) {
                        spinner.fail(`Copy failed: ${retryErr.message}`);
                    }
                } finally {
                    await rmRunningMarker();
                }
            }
        }
    } finally {
        isProcessing = false;
        if (pendingTrigger) {
            runCycle().catch(err => console.error(chalk.red("Follow-up cycle failed:"), err));
        }
    }
}

