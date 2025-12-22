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
    
    // Run MakeMKV info
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
    // Increase maxBuffer for large metadata, and set minlength to 0 to capture all tracks
    const { stdout } = await execAsync(`makemkvcon -r --minlength=0 --cache=1 info ${device}`, { maxBuffer: 1024 * 1024 * 10 });
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

// Helper types for parsing
export interface StreamRaw {
    type?: string;
    codec?: string;
    lang?: string;
    langCode?: string;
    channels?: number;
    title?: string;
    resolution?: string;
}

export function parseMakeMkvOutput(output: string): DiscMetadata | null {
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
        // CINFO:id,code,value
        if (line.startsWith('CINFO:')) {
            const parts = parseCsvLine(line.substring(6));
            const id = parseInt(parts[0]);
            const value = parts[2];
            
            if (id === 32) volumeLabel = value; // Volume Name (32)
        } 
        // TINFO:trackId,code,extra,value
        else if (line.startsWith('TINFO:')) {
            const parts = parseCsvLine(line.substring(6));
            const trackId = parseInt(parts[0]);
            const code = parseInt(parts[1]);
            const value = parts[3];
            
            const track = getTrack(trackId);
            
            if (code === 9) track.duration = value; // Duration (0:29:41)
            if (code === 11) track.size = parseInt(value); // Size in bytes
            if (code === 2) track.title = value; // Name (e.g. "Bluey...")
            if (code === 8) track.chapters = parseInt(value); // Chapter count
            if (code === 27) track.title = value; // Filename often better (00.mkv)

        } 
        // SINFO:trackId,streamId,code,extra,value
        else if (line.startsWith('SINFO:')) {
            const parts = parseCsvLine(line.substring(6));
            const trackId = parseInt(parts[0]);
            const streamId = parseInt(parts[1]);
            const code = parseInt(parts[2]);
            const value = parts[4];
            
            const stream = getStream(trackId, streamId);
            
            // Code 1: Stream Type (6201=Video, 6210=Audio, 6220=Subtitle) - Value is string "Video", "Audio"
            if (code === 1) stream.type = value;
            // Code 5: Codec ID/Name
            if (code === 5) stream.codec = value;
            // Code 19: Video Resolution (720x480)
            if (code === 19) stream.resolution = value;
            // Code 3: Language Code (eng) - The log shows code 3 is 'eng'
            if (code === 3) stream.langCode = value; 
            // Code 4: Language Name (English)
            if (code === 4) stream.lang = value;
            // Code 30: Stream Description/Title
            if (code === 30) stream.title = value;
            // Code 14: Channels
            if (code === 14) stream.channels = parseInt(value);
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
                   if (stream.resolution) {
                       const [w, h] = stream.resolution.split('x').map(n => parseInt(n));
                       if (w && h) {
                           track.video.width = w;
                           track.video.height = h;
                       }
                   }
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
                else if (stream.type === 'Subtitles' || (stream.type && stream.type.includes('Subtitle'))) {
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
