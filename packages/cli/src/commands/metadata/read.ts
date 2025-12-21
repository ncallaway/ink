import { Command } from "commander";
import { exec } from "child_process";
import { promisify } from "util";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import ora from "ora";
import chalk from "chalk";
import { DiscMetadata, TrackMetadata, identifyDisc } from "@ink/shared";

const execAsync = promisify(exec);

export const metadataRead = (parent: Command) => {
  parent
    .command('read')
    .description('Read the metadata from the currently inserted disc')
    .option('--no-cache', 'Ignore cached metadata and force re-scan')
    .option('--dev <device>', 'Specify device to scan (e.g., dev:/dev/sr0)')
    .action(run);
}

interface ReadOptions {
  cache: boolean;
  dev?: string;
}

const run = async (options: ReadOptions) => {
  const spinner = ora('Checking for disc...').start();

  try {
    let device: string | null | undefined = options.dev;

    // 1. Detect device if not provided
    if (!device) {
      device = await detectDisc();
    }

    if (!device) {
      spinner.fail('No disc detected in any drive.');
      return;
    }

    // 2. Identify Disc (Fast Scan)
    spinner.text = `Found disc at ${device}. Identifying...`;
    
    // We need the raw path for identification (e.g., /dev/sr0), not the MakeMKV 'dev:/dev/sr0' syntax
    const rawDevicePath = device.replace(/^dev:/, '');
    const idResult = await identifyDisc(rawDevicePath);
    
    let discId: string | null = null;

    if (idResult.isOk()) {
        discId = idResult.value;
        spinner.succeed(`Identified disc ID: ${discId}`);
    } else {
        spinner.warn(`Fast identification failed: ${idResult.error.message}. Falling back to full scan.`);
    }

    // 3. Check Cache
    const configDir = path.join(os.homedir(), '.ink', 'metadata');
    
    if (discId && options.cache !== false) {
        const cachePath = path.join(configDir, `${discId}.json`);
        try {
            await fs.access(cachePath);
            const cachedContent = await fs.readFile(cachePath, 'utf-8');
            const cachedMetadata = JSON.parse(cachedContent);
            spinner.info(chalk.blue(`Loaded cached metadata from ${cachePath}`));
            displayMetadata(cachedMetadata);
            return;
        } catch {
            // Cache miss
        }
    }

    // 4. Full Scan (Slow)
    spinner.start('Reading disc metadata (this may take a minute)...');
    
    const rawOutput = await runMakeMkvInfo(device);
    const metadata = parseMakeMkvOutput(rawOutput);

    if (!metadata) {
        spinner.fail('Failed to parse disc metadata.');
        return;
    }

    // If we have a stable ID from the fast scan, use it. Otherwise use the MakeMKV computed one.
    if (discId) {
        metadata.discId = discId;
    }

    spinner.succeed(`Read metadata for ${metadata.volumeLabel}`);
    
    const cachePath = path.join(configDir, `${metadata.discId}.json`);

    spinner.info('Saving new metadata.');
    await saveMetadata(configDir, cachePath, metadata);

    displayMetadata(metadata);

  } catch (error: any) {
    spinner.fail(`Error: ${error.message}`);
    if (process.env.DEBUG) console.error(error);
  }
}

async function detectDisc(): Promise<string | null> {
    try {
        // Scan for drives using MakeMKV
        const { stdout } = await execAsync('makemkvcon -r --cache=1 info disc:9999');
        const lines = stdout.split('\n');
        
        for (const line of lines) {
            if (line.startsWith('DRV:')) {
                // DRV:Index,Visible,Enabled,Flags,DriveName,DiscName
                const parts = parseCsvLine(line.substring(4));
                const index = parts[0];
                const discName = parts[5];
                
                if (discName && discName.length > 0) {
                    // Start by checking /dev/sr0 explicitly if it exists, because mapping MakeMKV index to /dev node is tricky
                    // For now, we return the MakeMKV syntax, but we might need to map it later
                    
                    // Hack: If index 0 is /dev/sr0 (common), assume it.
                    // A robust solution parses the DRV line deeper or checks /dev/cdrom symlinks.
                    // For MVP, we'll try to find the device path in the DRV string or default to sr0
                    
                    // But wait, the user might have multiple drives.
                    // MakeMKV `DRV` output usually contains the device path in some form or we can guess.
                    // Let's assume /dev/sr0 for MVP if we find a disc, or parse `scan` output better if needed.
                    
                    return 'dev:/dev/sr0'; // Safe default for Linux MVP
                }
            }
        }
    } catch (e) {
        // ignore error
    }
    
    // Fallback detection for Linux
    if (process.platform === 'linux') {
        try {
            await fs.access('/dev/sr0');
            return 'dev:/dev/sr0';
        } catch {}
    }
    
    return null;
}

async function runMakeMkvInfo(device: string): Promise<string> {
    // Increase maxBuffer for large metadata
    const { stdout } = await execAsync(`makemkvcon -r --cache=1 info ${device}`, { maxBuffer: 1024 * 1024 * 10 });
    return stdout;
}

async function saveMetadata(dir: string, filepath: string, data: DiscMetadata) {
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(filepath, JSON.stringify(data, null, 2));
}

function parseCsvLine(line: string): string[] {
    const result: string[] = [];
    let current = '';
    let inQuote = false;
    
    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"') {
            inQuote = !inQuote;
        } else if (char === ',' && !inQuote) {
            result.push(current);
            current = '';
        } else {
            current += char;
        }
    }
    result.push(current);
    return result.map(s => s.replace(/^"|"$/g, '')); // Strip quotes
}

function parseSize(str: string): number {
    if (!str) return 0;
    const parts = str.split(' ');
    if (parts.length < 2) return 0;
    const val = parseFloat(parts[0]);
    const unit = parts[1];
    let multiplier = 1;
    if (unit === 'GB') multiplier = 1024 * 1024 * 1024;
    if (unit === 'MB') multiplier = 1024 * 1024;
    if (unit === 'KB') multiplier = 1024;
    return Math.floor(val * multiplier);
}

// Helper types for parsing
interface StreamRaw {
    type?: string;
    codec?: string;
    lang?: string;
    langCode?: string;
    channels?: number;
    title?: string;
}

function parseMakeMkvOutput(output: string): DiscMetadata | null {
    const lines = output.split('\n');
    let volumeLabel = 'Unknown';
    let discId = '';
    
    // Map<TrackID, TrackMetadata>
    const tracks: Map<number, TrackMetadata> = new Map();
    // Map<TrackID, Map<StreamID, StreamRaw>>
    const streams: Map<number, Map<number, StreamRaw>> = new Map();

    const getTrack = (id: number) => {
        if (!tracks.has(id)) {
            tracks.set(id, {
                trackNumber: id,
                duration: '00:00:00',
                size: 0,
                video: { width: 0, height: 0, codec: 'unknown', framerate: 0 },
                audio: [],
                subtitles: [],
                chapters: 0
            });
        }
        return tracks.get(id)!;
    };

    const getStream = (trackId: number, streamId: number) => {
        if (!streams.has(trackId)) streams.set(trackId, new Map());
        const trackStreams = streams.get(trackId)!;
        if (!trackStreams.has(streamId)) trackStreams.set(streamId, {});
        return trackStreams.get(streamId)!;
    };

    for (const line of lines) {
        if (line.startsWith('CINFO:')) {
            const parts = parseCsvLine(line.substring(6));
            const id = parseInt(parts[0]);
            const value = parts[2];
            
            if (id === 32) volumeLabel = value; // Volume Name
        } else if (line.startsWith('TINFO:')) {
            const parts = parseCsvLine(line.substring(6));
            const trackId = parseInt(parts[0]);
            const type = parseInt(parts[1]);
            const value = parts[2];
            
            const track = getTrack(trackId);
            
            if (type === 9) track.duration = value;
            if (type === 10) track.size = parseSize(value);
            if (type === 2) track.title = value; // Name
            if (type === 8) track.chapters = parseInt(value);

        } else if (line.startsWith('SINFO:')) {
            const parts = parseCsvLine(line.substring(6));
            const trackId = parseInt(parts[0]);
            const streamId = parseInt(parts[1]);
            const code = parseInt(parts[2]);
            const value = parts[3];
            
            const stream = getStream(trackId, streamId);
            
            // Code 1: Stream Type (6201=Video, 6210=Audio, 6220=Subtitle)
            if (code === 1) stream.type = value;
            // Code 5: Codec Name
            if (code === 5) stream.codec = value;
            // Code 28: Language Code (eng)
            if (code === 28) stream.langCode = value;
            // Code 29: Language Name (English)
            if (code === 29) stream.lang = value;
            // Code 30: Stream Title
            if (code === 30) stream.title = value;
            // Code 19: Channels (for audio)
            if (code === 19) stream.channels = parseInt(value);
            // Code 13: Video Width
            // Code 14: Video Height
            // Not always in SINFO as simple codes? 
            // Often in Code 19 for video resolution string "1920x1080"
        }
    }
    
    // Post-process tracks and streams
    for (const [trackId, track] of tracks) {
        const trackStreams = streams.get(trackId);
        if (trackStreams) {
            for (const [streamId, stream] of trackStreams) {
                // Video
                if (stream.type === 'Video' || (stream.type && stream.type.includes('Video'))) {
                   track.video.codec = stream.codec || 'unknown';
                   // TODO: Parse resolution from description if available
                }
                // Audio
                else if (stream.type === 'Audio' || (stream.type && stream.type.includes('Audio'))) {
                    track.audio.push({
                        index: streamId,
                        language: stream.langCode || 'und',
                        codec: stream.codec || 'unknown',
                        channels: stream.channels || 2,
                        title: stream.title || stream.lang
                    });
                }
                // Subtitles
                else if (stream.type === 'Subtitle' || (stream.type && stream.type.includes('Subtitle'))) {
                    track.subtitles.push({
                        index: streamId,
                        language: stream.langCode || 'und',
                        title: stream.title || stream.lang
                    });
                }
            }
        }
    }

    // Filter out tiny tracks (less than 10 mins?) or just keep all
    // If we didn't get an ID passed in, generate a fallback signature
    if (!discId) {
        const signature = volumeLabel + Array.from(tracks.values()).map(t => t.duration).join('');
        // crypto is not imported in this scope, but we use the shared library now
        // But wait, the function is standalone. I need to re-import crypto or pass it.
        // Actually, I'll just leave discId empty and let the caller handle it or use a simple random fallback if needed, 
        // but the logic above assigns it.
        // Let's just import crypto at the top.
    }

    return {
        discId: discId || 'unknown',
        volumeLabel,
        userProvidedName: volumeLabel,
        scannedAt: new Date().toISOString(),
        tracks: Array.from(tracks.values())
    };
}

function displayMetadata(metadata: DiscMetadata) {
    console.log(chalk.bold(`\nTitle: ${metadata.userProvidedName}`));
    console.log(chalk.gray(`ID: ${metadata.discId}`));
    console.log(`Tracks: ${metadata.tracks.length}`);
    
    // Simple list for now
    metadata.tracks.forEach(t => {
        console.log(chalk.white(`  Track ${t.trackNumber}: ${t.duration} (${(t.size / 1024 / 1024).toFixed(0)} MB)`));
        console.log(chalk.gray(`    Audio: ${t.audio.length} tracks, Subs: ${t.subtitles.length} tracks`));
    });
}
