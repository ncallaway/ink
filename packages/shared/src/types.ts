export type DiscId = string & { __brand: "disc:DiscId" };
export type TrackNumber = number & { __brand: "disc:TrackNumber" };
export type DevicePath = string & { __brand: "drive:DevicePath" };

// ============================================================================
// Disc & Metadata Types
// ============================================================================
/**
 * Drive Statuses based on Linux CDROM_DRIVE_STATUS
 * 
 * 1 = no disk in tray
 * 2 = tray open
 * 3 = reading tray
 * 4 = disk in tray
 */
export enum DriveStatus {
  NO_INFO = 0,
  NO_DISK = 1,
  TRAY_OPEN = 2,
  READING = 3,
  DISK_PRESENT = 4,
}

export interface DiscMetadata {
  discId: DiscId;
  volumeLabel: string;
  userProvidedName: string;
  scannedAt: string;
  tracks: TrackMetadata[];
}

export interface TrackMetadata {
  trackNumber: TrackNumber;
  title?: string;
  duration: string;
  size: number;
  video: VideoInfo;
  audio: AudioTrack[];
  subtitles: SubtitleTrack[];
  chapters: number;
}

export interface VideoInfo {
  width: number;
  height: number;
  codec: string;
  framerate: number;
}

export interface AudioTrack {
  index: number;
  language: string;
  codec: string;
  channels: number;
  title?: string;
}

export interface SubtitleTrack {
  index: number;
  language: string;
  title?: string;
}

export namespace MakeMKV {
  export type DriveIndex = number & { __brand: "makemkv:drive:Index" };
}

// ============================================================================
// Plan Types
// ============================================================================

export interface BackupPlan {
  discId: DiscId;
  discLabel: string;
  title: string;
  imdbId?: string;
  tvShow?: {
    imdbId: string;
    tvMazeId?: number;
    name: string;
    season: number;
    disc: number;
  };
  // For compilation discs, we store the pool of episodes to match against later
  candidates?: CandidateEpisode[]; 
  createdAt: string;
  updatedAt: string;
  status: 'draft' | 'pending' | 'review' | 'approved' | 'completed';
  type: 'movie' | 'tv';
  tracks: TrackPlan[];
}

export interface CandidateEpisode {
  id: number;
  season: number;
  number: number;
  name: string;
}

export interface TrackPlan {
  trackNumber: TrackNumber;
  name: string;
  extract: boolean;
  transcode?: TranscodeSettings;
  output: OutputSettings;
}

export interface TranscodeSettings {
  codec: string;
  preset: string;
  crf: number;
  audio: string[];
  subtitles: string[];
  crop?: string;
  deinterlace?: boolean;
  isAnimated?: boolean;
}

export interface OutputSettings {
  filename: string;
  directory: string;
}

// ============================================================================
// Job Types
// ============================================================================

export type TrackQueue = 'extract' | 'transcode' | 'review' | 'copy';

// a track can be:
// blocked - the track will eventually run through this queue, but it is not yet ready to run through the queue.
// ready - this track will run through the queue, and has met all the requirements
// running - it is actively being processed right now
// done - the track finished being processed by the queue.
// errror - the track started to run through the queue, but had a problem
// ineligible - it will not run through this queue
export type TrackQueueStatus = 'blocked' | 'ready' | 'running' | 'done' | 'error' | 'ineligible';

export type TrackStatus = 'complete' | 'ready' | 'running' | 'error' | 'ignored';

export type TrackState = {
  queues: Record<TrackQueue, TrackQueueStatus>,
  status: TrackStatus
}


export type JobStatus = 
  | 'pending' 
  | 'extracting' 
  | 'transcoding' 
  | 'finalizing' 
  | 'completed' 
  | 'failed' 
  | 'cancelled' 
  | 'retrying';

export interface Job {
  id: string;
  discId: DiscId;
  trackNumber: TrackNumber;
  status: JobStatus;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  progress?: JobProgress;
  error?: string;
}

export interface JobProgress {
  stage: 'extract' | 'transcode' | 'finalize';
  percentage: number;
  speed?: string;
  eta?: string;
  currentSize?: number;
  estimatedFinalSize?: number;
}

// ============================================================================
// Configuration Types
// ============================================================================

export interface InkConfig {
  daemon: DaemonConfig;
  extraction: ExtractionConfig;
  transcoding: TranscodingConfig;
  storage: StorageConfig;
}

export interface DaemonConfig {
  autoStart: boolean;
  autoExecutePlans: boolean;
  notifyOnPlanReady: boolean;
  port: number;
}

export interface ExtractionConfig {
  stagingDirectory: string;
  keepRawMkv: boolean;
}

export interface TranscodingConfig {
  concurrentJobs: number;
  defaultCodec: string;
  defaultPreset: string;
  defaultCrf: number;
}

export interface StorageConfig {
  metadataDirectory: string;
  plansDirectory: string;
}

// ============================================================================
// API Types
// ============================================================================

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface DaemonStatus {
  status: 'running' | 'stopped';
  version: string;
  uptime: number;
  activeJobs: number;
}
