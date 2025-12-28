import { Command } from "commander";
import * as path from "path";
import chalk from "chalk";
import ora from "ora";
import { exec } from "child_process";
import { promisify } from "util";
import { loadPlan } from "../plan/utils";
import { 
    getStagingDir,
    getEncodedPath, 
    getEncodedStatusPath, 
    getReviewedStatusPath,
    getCopiedStatusPath, 
    hasStatus,
    writeStatus
} from "./utils";

export const runCopy = (parent: Command) => {
  parent
    .command('copy')
    .description('Copy finalized files to SMB destination')
    .action(run);
}

async function run() {
    const execAsync = promisify(exec);
    const stagingDir = getStagingDir();
    const smbTarget = process.env.SMB_TARGET || 'smb://192.168.1.200/storage/media';
    const smbUser = process.env.SMB_USER || 'user';
    const smbPass = process.env.SMB_PASSWORD || 'password';

    // Parse SMB Target
    // Format: smb://host/share/path/prefix
    const match = smbTarget.match(/^smb:\/\/([^\/]+)\/([^\/]+)(.*)$/);
    if (!match) {
        console.error("Invalid SMB_TARGET format. Expected smb://host/share/path");
        return;
    }
    const [, host, share, prefixPath] = match; // prefixPath might be "/media"

    const discDirs = await fs.readdir(stagingDir);
    let processedAny = false;

    for (const discId of discDirs) {
        if (discId.startsWith('.')) continue;

        const plan = await loadPlan(discId);
        if (!plan) continue;

        for (const track of plan.tracks) {
            const encodedStatus = getEncodedStatusPath(discId, track.trackNumber);
            const reviewedStatus = getReviewedStatusPath(discId, track.trackNumber);
            const copiedStatus = getCopiedStatusPath(discId, track.trackNumber);

            // Logic: 
            // 1. Must be encoded.
            // 2. If TV, must be reviewed.
            // 3. Must not be already copied.
            const isEncoded = await hasStatus(encodedStatus);
            const isReviewed = await hasStatus(reviewedStatus);
            const isCopied = await hasStatus(copiedStatus);

            if (isEncoded && !isCopied) {
                // TV shows REQUIRE review. Movies do not.
                if (plan.type === 'tv' && !isReviewed) {
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
                
                // CHECK FOR RESOLVED NAME
                if (await hasStatus(reviewedStatus)) {
                    try {
                        const reviewedContent = await fs.readFile(reviewedStatus, 'utf-8');
                        const reviewedData = JSON.parse(reviewedContent);
                        if (reviewedData.finalName) {
                            remoteFilename = reviewedData.finalName;
                        }
                    } catch {}
                }

                // Ensure extension matches source (usually .mkv) if missing
                const sourceExt = path.extname(localPath);
                if (!path.extname(remoteFilename)) {
                    remoteFilename += sourceExt;
                }

                const cleanPrefix = prefixPath.replace(/^\//, '').replace(/\/$/, '');
                const cleanSuffix = suffix.replace(/^\//, ''); // relative
                
                const remoteDir = path.join(cleanPrefix, cleanSuffix).replace(/\\/g, '/');
                const remotePath = path.join(cleanPrefix, cleanSuffix, remoteFilename).replace(/\\/g, '/');

                console.log(chalk.blue(`\n[Track ${track.trackNumber}] ${track.name}`));
                
                // Escape single quotes for the shell command string
                const smbCommandString = `mkdir "${remoteDir}"; put "${localPath}" "${remotePath}"`.replace(/'/g, "'\\''");
                const cmd = `smbclient '//${host}/${share}' -U '${smbUser}%${smbPass}' -c '${smbCommandString}'`;
                
                const spinner = ora(`Copying to ${smbTarget}/${cleanSuffix}/${remoteFilename}...`).start();
                
                try {
                    await execAsync(cmd);
                    spinner.succeed("Copy complete.");

                    // Write Status
                    await writeStatus(copiedStatus, {
                        discId,
                        trackNumber: track.trackNumber,
                        timestamp: new Date().toISOString(),
                        destination: `smb://${host}/${share}/${remotePath}`
                    });

                } catch (e: any) {
                    spinner.text = "Retrying copy without mkdir...";
                    try {
                         const cmdRetry = `smbclient '//${host}/${share}' -U '${smbUser}%${smbPass}' -c 'put "${localPath}" "${remotePath}"'`;
                         await execAsync(cmdRetry);
                         spinner.succeed("Copy complete (Retry).");
                         
                         await writeStatus(copiedStatus, {
                            discId,
                            trackNumber: track.trackNumber,
                            timestamp: new Date().toISOString(),
                            destination: `smb://${host}/${share}/${remotePath}`
                        });
                    } catch (retryErr: any) {
                        spinner.fail(`Copy failed: ${retryErr.message}`);
                    }
                }
            }
        }
    }

    if (!processedAny) {
        console.log("No pending copies found.");
    }
}

import * as fs from "fs/promises";

