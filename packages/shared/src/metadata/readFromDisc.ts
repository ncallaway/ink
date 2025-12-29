import { Ora } from "ora";
import { DevicePath, DiscId, DiscMetadata, TrackMetadata, TrackNumber } from "../types";
import { makemkv, ProgressUpdate } from "../makemkv";
import { disc } from "../disc";
import { storage } from "../storage";
import { err, ok, Result, ResultAsync } from "neverthrow";
import { toError } from "../util";


export type MetadataReadOptions = {
  spinner?: Ora;
  /**
   * force: true will overwrite existing metadata. default: false
   */
  force?: boolean;
  discId?: DiscId
}

export const readFromDisc = async (device: DevicePath, options: MetadataReadOptions = {}): Promise<Result<DiscMetadata, Error>> => {
  const { spinner } = options;

  // Identify the disc
  let discId: DiscId | null = options?.discId ?? null;

  if (!discId) {
    spinner?.start(`Identifying the disc in ${device}...`);
    const idResult = await disc.identify(device);

    if (idResult.isOk()) {
      discId = idResult.value;
      spinner?.succeed(`Identified disc ID: ${discId}`);
    } else {
      spinner?.fail(`Failed to identify the disc: ${idResult.error.message}.`);
      return err(idResult.error);
    }
  }

  // Read from the cache if we are allowed to
  if (discId && !options.force) {
    const metadataRes = await storage.readMetadata(discId);

    if (metadataRes.isOk()) {
      return ok(metadataRes.value);
    } else {
      const e: any = metadataRes.error;

      // if the error is no entry, that means metadata doesn't exist, and we
      // should continue. If the error is anything else, we should propagate it.
      if (e.code !== 'ENOENT') {
        return err(metadataRes.error);
      }
    }
  }

  spinner?.start('Reading metadata (this may take a minute)...');

  // Resolve Device Path to MakeMKV Drive Index
  const indexResult = await makemkv.findDriveIndex(device);
  if (indexResult.isErr()) {
    spinner?.fail(`Could not find MakeMKV drive index for ${device}: ${indexResult.error.message}`);
    return err(new Error(`Could not find MakeMKV drive index for ${device}`, indexResult.error));
  }
  const driveIndex = indexResult.value;

  const progressCallback = spinner ? (progress : ProgressUpdate) => {
    let text = progress.message ? `Reading metadata: ${progress.message}` : "Reading metadata (this may take a minute)...";
    if (progress.percentage !== undefined && progress.message) {
      text += ` ${progress.percentage.toFixed(1)}%`;
    }
    spinner.text = text;
  } : undefined; 
  const rawOutput = await makemkv.runInfo(driveIndex, progressCallback);
  const metadata = parseMakeMkvOutput(rawOutput, discId);

  if (!metadata) {
    spinner?.fail('Failed to parse disc metadata.');
    return err(new Error("Failed to parse disc metadata"));
  }

  const saveRes = await ResultAsync.fromPromise(storage.saveMetadata(discId, metadata), toError);
  if (saveRes.isErr()) {
    console.error("failed to save metadata: ", saveRes.error);
    console.error("metadata was: ");
    console.error(JSON.stringify(metadata, null, 2));
    return err(new Error("Failed to save metadata: ", saveRes.error));
  }

  spinner?.succeed(`Read metadata for ${metadata.volumeLabel}`);
  return ok(metadata);
}

interface StreamRaw {
  type?: string;
  codec?: string;
  lang?: string;
  langCode?: string;
  channels?: number;
  title?: string;
  resolution?: string;
}

const parseMakeMkvOutput = (output: string, discId: DiscId): DiscMetadata | null => {
  const lines = output.split('\n');
  let volumeLabel = 'Unknown';

  // Map<TrackID, TrackMetadata>
  const tracks: Map<number, TrackMetadata> = new Map();
  // Map<TrackID, Map<StreamID, StreamRaw>>
  const streams: Map<number, Map<number, StreamRaw>> = new Map();

  const getTrack = (id: number) => {
    if (!tracks.has(id)) {
      tracks.set(id, {
        trackNumber: id as TrackNumber,
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
      const parts = makemkv.parseCsvLine(line.substring(6));
      const id = parseInt(parts[0]);
      const value = parts[2];

      if (id === 32) volumeLabel = value; // Volume Name (32)
    } 
    // TINFO:trackId,code,extra,value
    else if (line.startsWith('TINFO:')) {
      const parts = makemkv.parseCsvLine(line.substring(6));
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
      const parts = makemkv.parseCsvLine(line.substring(6));
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

  return {
    discId,
    volumeLabel,
    userProvidedName: undefined,
    scannedAt: new Date().toISOString(),
    tracks: Array.from(tracks.values())
  };
}
