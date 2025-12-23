import { Command } from "commander";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import * as readline from "node:readline";
import ora, { Ora } from "ora";
import chalk from "chalk";
import { DevicePath, DiscId, DiscMetadata, DriveStatus, TrackMetadata, lib } from "@ink/shared";
import { getMetadataDir, displayMetadata } from "./utils";

export const metadataRead = (parent: Command) => {
  parent
    .command('read')
    .description('Read the metadata from the currently inserted disc')
    .option('--no-cache', 'Ignore cached metadata and force re-scan')
    .option('--dev <device>', 'Specify device to scan (e.g., /dev/sr0)')
    .action(run);
}

interface ReadOptions {
  cache: boolean;
  dev?: DevicePath;
}

const run = async (options: ReadOptions) => {
  const spinner = ora('Checking for disc...').start();

  try {
    // 1 - select the device to use (may be defined by the options)
    const device = await selectDevice(spinner, options);
    if (!device) {
      spinner.fail("No device was detected");
      process.exit(1);
    }

    // 2 - wait for the device to be ready 
    await waitForDevice(spinner, device);

    // 3 - identify the disc
    spinner.text = `Found disc at ${device}. Identifying...`;
    const idResult = await lib.disc.identify(device);

    let discId: DiscId | null = null;
    if (idResult.isOk()) {
      discId = idResult.value;
      spinner.succeed(`Identified disc ID: ${discId}`);
    } else {
      spinner.fail(`Disc identification failed: ${idResult.error.message}.`);
      process.exit(3);
    }


    // 3. Check Cache
    const configDir = getMetadataDir();

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

    // Resolve Device Path to MakeMKV Drive Index
    const indexResult = await lib.makemkv.findDriveIndex(device);
    if (indexResult.isErr()) {
       spinner.fail(`Could not find MakeMKV drive index for ${device}: ${indexResult.error.message}`);
       return;
    }
    const driveIndex = indexResult.value;

    // Run MakeMKV info
    const rawOutput = await lib.makemkv.runInfo(driveIndex);
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
    
    // Initial save with empty name
    metadata.userProvidedName = "";
    await saveMetadata(configDir, cachePath, metadata);

    // Prompt user for name
    spinner.stop();
    const userTitle = await promptUserForName(metadata.volumeLabel);
    metadata.userProvidedName = userTitle;
    spinner.start('Saving final metadata...');

    await saveMetadata(configDir, cachePath, metadata);
    spinner.succeed(`Saved metadata for ${metadata.userProvidedName}`);

    displayMetadata(metadata);

  } catch (error: any) {
    spinner.fail(`Error: ${error.message}`);
    if (process.env.DEBUG) console.error(error);
  }
}

async function promptUserForName(defaultName: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => {
    rl.question(chalk.yellow(`\nEnter a name for this disc (default: ${defaultName}): `), (answer) => {
      rl.close();
      resolve(answer.trim() || defaultName);
    });
  });
}

async function saveMetadata(dir: string, filepath: string, data: DiscMetadata) {
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(filepath, JSON.stringify(data, null, 2));
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
      const parts = lib.makemkv.parseCsvLine(line.substring(6));
      const id = parseInt(parts[0]);
      const value = parts[2];

      if (id === 32) volumeLabel = value; // Volume Name (32)
    } 
    // TINFO:trackId,code,extra,value
    else if (line.startsWith('TINFO:')) {
      const parts = lib.makemkv.parseCsvLine(line.substring(6));
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
      const parts = lib.makemkv.parseCsvLine(line.substring(6));
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

const selectDevice = async (spinner: Ora, options: ReadOptions): Promise<DevicePath> => {
  let device: DevicePath = options.dev as DevicePath;

  // 1. Detect device if not provided
  if (!device) {
    const drivesResult = lib.drive.list();
    if (drivesResult.isErr()) {
      spinner.fail(`Could not list drives: ${drivesResult.error.message}`);
      process.exit(101);
    }

    const drives = drivesResult.value;
    if (drives.length === 0) {
      spinner.fail('No optical drives found on this system.');
      process.exit(1);
    }

    // Default to the first drive found
    // TODO: Handle multiple drives selection or parallel processing in future
    if (drives.length > 0) {
      device = drives[0] as DevicePath;
    }
  }

  return device;
}

const waitForDevice = async (spinner: Ora, device: DevicePath) => {
  spinner.text = `Checking status of ${device}...`;
  let attempts = 0;
  const maxAttempts = 60; // 60 seconds

  while (attempts < maxAttempts) {
    const statusResult = lib.drive.status(device);

    if (statusResult.isErr()) {
      // If we can't even check status (e.g. permission denied), fail
      spinner.fail(`Failed to check drive status: ${statusResult.error.message}`);
      process.exit(1);
    }

    const status = statusResult.value;

    if (status === DriveStatus.DISK_PRESENT) {
      // Ready!
      // if the device was ready on the first attempt, stop waiting immediately. If the device *just* became ready, wait
      // an extra 2 seconds, because we often can't mount the drive the moment it transitions to disk_present
      if (attempts > 0) {
        spinner.text = `Drive ${device} is present, waiting 5s to mount it`;
        await new Promise(r => setTimeout(r, 5000));
      }
      break;
    } else if (status === DriveStatus.READING) {
      // Drive is busy/spinning up
      spinner.text = `Drive ${device} is reading... (Attempt ${attempts + 1}/${maxAttempts})`;
      await new Promise(r => setTimeout(r, 1000));
      attempts++;
    } else if (status === DriveStatus.NO_DISK || status === DriveStatus.TRAY_OPEN) {
      spinner.fail(`Drive ${device} is empty or open.`);
      process.exit(2);
    } else {
      spinner.fail(`Drive ${device} returned unknown status: ${status}`);
      process.exit(1);
    }
  }

  if (attempts >= maxAttempts) {
    spinner.fail(`Timed out waiting for drive ${device} to become ready.`);
    process.exit(1);
  }
}


