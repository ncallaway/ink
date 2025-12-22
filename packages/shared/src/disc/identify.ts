import { ok, err, Result } from 'neverthrow';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';

import { DevicePath, DiscId } from "../types";

const execAsync = promisify(exec);

interface MountInfo {
    path: string;
    wasMountedByUs: boolean;
}

/**
 * Identifies a disc by hashing its navigation structure (IFO for DVD, BDMV for Blu-ray).
 * Falls back to Volume UUID if structure is unrecognized.
 * 
 * @param devicePath The device path (e.g., /dev/sr0)
 */
export async function identify(devicePath: DevicePath): Promise<Result<DiscId, Error>> {
    const mountResult = await ensureMounted(devicePath);
    
    if (mountResult.isErr()) {
        return err(mountResult.error);
    }

    const mountPath = mountResult.value;

    try {
        // 1. Try DVD Structure
        const dvdPath = path.join(mountPath, 'VIDEO_TS');
        if (await exists(dvdPath)) {
            return await hashDvdStructure(dvdPath);
        }

        // 2. Try Blu-ray Structure
        const bdPath = path.join(mountPath, 'BDMV');
        if (await exists(bdPath)) {
            return await hashBluRayStructure(bdPath);
        }

        // 3. Fallback to UUID
        // We already have the device path, let's get the UUID from lsblk
        return await getVolumeUuid(devicePath);

    } catch (error: any) {
        return err(new Error(`Identification failed: ${error.message}`));
    }
}

async function ensureMounted(devicePath: DevicePath): Promise<Result<string, Error>> {
    try {
        // 1. Check if already mounted
        const { stdout } = await execAsync(`lsblk -J -o MOUNTPOINT ${devicePath}`);
        const data = JSON.parse(stdout);
        
        // lsblk output format: { "blockdevices": [ { "mountpoint": "..." } ] }
        if (data.blockdevices && data.blockdevices.length > 0) {
            const mp = data.blockdevices[0].mountpoint;
            if (mp) {
                return ok(mp);
            }
        }

        // 2. Not mounted, try udisksctl
        // -b: block device
        const mountCmd = await execAsync(`udisksctl mount -b ${devicePath}`);
        // Output format: "Mounted /dev/sr0 at /media/user/Label"
        const match = mountCmd.stdout.match(/at\s+(.*)$/m);
        if (match && match[1]) {
            return ok(match[1].trim().replace(/\.$/, '')); // Remove trailing dot if present
        }

        return err(new Error('Failed to parse mount point from udisksctl output'));

    } catch (error: any) {
        return err(new Error(`Failed to mount disc: ${error.message}`));
    }
}

async function hashDvdStructure(videoTsPath: string): Promise<Result<string, Error>> {
    try {
        const files = await fs.readdir(videoTsPath);
        // Filter for .IFO files (case insensitive)
        const ifoFiles = files.filter(f => f.toUpperCase().endsWith('.IFO')).sort();
        
        if (ifoFiles.length === 0) {
            return err(new Error('No IFO files found in VIDEO_TS'));
        }

        const hasher = crypto.createHash('md5');
        
        for (const file of ifoFiles) {
            const content = await fs.readFile(path.join(videoTsPath, file));
            hasher.update(content);
        }

        return ok(hasher.digest('hex'));
    } catch (e: any) {
        return err(e);
    }
}

async function hashBluRayStructure(bdmvPath: string): Promise<Result<string, Error>> {
    try {
        const hasher = crypto.createHash('md5');
        const filesToHash = ['index.bdmv', 'MovieObject.bdmv'];
        let foundAny = false;

        for (const file of filesToHash) {
            const filePath = path.join(bdmvPath, file);
            if (await exists(filePath)) {
                const content = await fs.readFile(filePath);
                hasher.update(content);
                foundAny = true;
            }
        }

        if (!foundAny) {
            return err(new Error('Critical BDMV files missing'));
        }

        return ok(hasher.digest('hex'));
    } catch (e: any) {
        return err(e);
    }
}

async function getVolumeUuid(devicePath: string): Promise<Result<string, Error>> {
    try {
        const { stdout } = await execAsync(`lsblk -n -o UUID ${devicePath}`);
        const uuid = stdout.trim();
        if (!uuid) return err(new Error('No UUID found for device'));
        return ok(uuid);
    } catch (e: any) {
        return err(e);
    }
}

async function exists(f: string): Promise<boolean> {
    try {
        await fs.access(f);
        return true;
    } catch {
        return false;
    }
}
