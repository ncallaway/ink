import * as path from "path";
import * as os from "os";
import * as fs from "fs/promises";
import { DiscId, lib } from "@ink/shared";

export const getStagingDir = () => path.join(os.homedir(), '.ink', 'staging');

export const getDiscStagingDir = (discId: string) => path.join(getStagingDir(), discId);

export const getExtractedDir = (discId: string) => path.join(getDiscStagingDir(discId), 'extracted');
export const getEncodedDir = (discId: string) => path.join(getDiscStagingDir(discId), 'encoded');
export const getReviewedDir = (discId: string) => path.join(getDiscStagingDir(discId), 'reviewed');
export const getCopiedDir = (discId: string) => path.join(getDiscStagingDir(discId), 'copied');

export const getExtractedPath = (discId: string, track: number) => path.join(getExtractedDir(discId), `t${track.toString().padStart(2, '0')}.mkv`);
export const getEncodedPath = (discId: string, track: number) => path.join(getEncodedDir(discId), `t${track.toString().padStart(2, '0')}.mkv`);

// Status file paths
export const getExtractedStatusPath = (discId: string, track: number) => path.join(getExtractedDir(discId), `t${track.toString().padStart(2, '0')}.done`);
export const getEncodedStatusPath = (discId: string, track: number) => path.join(getEncodedDir(discId), `t${track.toString().padStart(2, '0')}.done`);
export const getReviewedStatusPath = (discId: string, track: number) => path.join(getReviewedDir(discId), `t${track.toString().padStart(2, '0')}.done`);
export const getCopiedStatusPath = (discId: string, track: number) => path.join(getCopiedDir(discId), `t${track.toString().padStart(2, '0')}.done`);

export async function ensureDirs(discId: DiscId) {
  lib.storage.ensureStagingDirectories(discId as DiscId);
}

export async function hasStatus(path: string): Promise<boolean> {
    try {
        await fs.access(path);
        return true;
    } catch {
        return false;
    }
}

export async function writeStatus(path: string, data: any) {
    await fs.writeFile(path, JSON.stringify(data, null, 2));
}

export async function getTrackStatus(discId: string, track: number): Promise<'pending' | 'extracted' | 'encoded' | 'reviewed' | 'completed'> {
    if (await hasStatus(getCopiedStatusPath(discId, track))) return 'completed';
    if (await hasStatus(getReviewedStatusPath(discId, track))) return 'reviewed';
    if (await hasStatus(getEncodedStatusPath(discId, track))) return 'encoded';
    if (await hasStatus(getExtractedStatusPath(discId, track))) return 'extracted';
    return 'pending';
}

export interface StatusFile {
    timestamp: string;
    discId: string;
    trackNumber: number;
    [key: string]: any;
}
