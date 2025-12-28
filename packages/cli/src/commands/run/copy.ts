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
    getCopiedStatusPath, 
    hasStatus,
    writeStatus
} from "./utils";

const execAsync = promisify(exec);

export const runCopy = (parent: Command) => {
  parent
    .command('copy')
    .description('Copy finalized files to SMB destination')
    .action(run);
}

async function run() {
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
            const copiedStatus = getCopiedStatusPath(discId, track.trackNumber);

            if (await hasStatus(encodedStatus) && !(await hasStatus(copiedStatus))) {
                processedAny = true;
                
                const localPath = getEncodedPath(discId, track.trackNumber);
                
                // Determine remote path
                // If plan directory is absolute, try to make it relative or use plan title
                // For this demo, let's assume we want "Type/Title/Filename"
                // e.g. "Movies/Home Alone/Home Alone.mkv"
                
                // Use the suffix provided in the plan output directory if it looks relative, 
                // otherwise fallback to plan logic.
                let suffix = track.output.directory;
                if (path.isAbsolute(suffix)) {
                    // Fallback logic: Use plan type + title
                    const typeDir = plan.type === 'tv' ? 'TV Shows' : 'Movies';
                    suffix = path.join(typeDir, plan.title);
                }

                let remoteFilename = track.output.filename;
                // Ensure extension matches source (usually .mkv) if missing
                const sourceExt = path.extname(localPath);
                if (!path.extname(remoteFilename)) {
                    remoteFilename += sourceExt;
                }

                // SMB paths use backslashes usually? smbclient 'put' uses forward slashes in the path arg typically
                // but remote path on server is relative to share.
                // Remote: prefixPath + / + suffix + / + filename
                // Remove leading slashes to be safe for join
                const cleanPrefix = prefixPath.replace(/^\//, '').replace(/\/$/, '');
                const cleanSuffix = suffix.replace(/^\//, ''); // relative
                
                const remoteDir = path.join(cleanPrefix, cleanSuffix).replace(/\\/g, '/');
                const remotePath = path.join(cleanPrefix, cleanSuffix, remoteFilename).replace(/\\/g, '/');

                console.log(chalk.blue(`\n[Track ${track.trackNumber}] ${track.name}`));
                const spinner = ora(`Copying to ${smbTarget}/${cleanSuffix}/${remoteFilename}...`).start();
                
                // smbclient //host/share -U user%pass -c 'mkdir "dir"; put "local" "remote"'
                // mkdir might fail if exists, but we hope put succeeds.
                // We use -D to set directory? No, -c is better.
                const cmd = `smbclient '//${host}/${share}' -U '${smbUser}%${smbPass}' -c 'mkdir "${remoteDir}"; put "${localPath}" "${remotePath}"'`;
                
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
                    // If failed, try without mkdir in case that was the error (though smbclient usually processes commands sequentially)
                    // If mkdir failed, put might still work if dir exists?
                    // Actually, if mkdir fails, smbclient might exit.
                    // We can try `put` alone if the first failed.
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
                        // console.error(retryErr); // Debug
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

