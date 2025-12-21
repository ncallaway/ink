/**
 * Ink Shared Library
 * 
 * Common types, schemas, and utilities used across the Ink system
 */

// ============================================================================
// Disc & Metadata Types
// ============================================================================

export interface DiscMetadata {
  discId: string;
  volumeLabel: string;
  userProvidedName: string;
  scannedAt: string;
  tracks: TrackMetadata[];
}

export interface TrackMetadata {
  trackNumber: number;
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

// ============================================================================
// Plan Types
// ============================================================================

export interface BackupPlan {
  discId: string;
  discLabel: string;
  createdAt: string;
  tracks: TrackPlan[];
}

export interface TrackPlan {
  trackNumber: number;
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
}

export interface OutputSettings {
  filename: string;
  directory: string;
}

// ============================================================================
// Job Types
// ============================================================================

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
  discId: string;
  trackNumber: number;
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

// ============================================================================
// Utility Functions
// ============================================================================

export function getDefaultConfig(): InkConfig {
  // TODO: Implement proper config defaults using OS APIs
  const homeDir = '~';
  
  return {
    daemon: {
      autoStart: true,
      autoExecutePlans: false,
      notifyOnPlanReady: true,
      port: 3142,
    },
    extraction: {
      stagingDirectory: '/tmp/ink-staging',
      keepRawMkv: false,
    },
    transcoding: {
      concurrentJobs: 2, // Default: 1 per 4 cores
      defaultCodec: 'h265',
      defaultPreset: 'slow',
      defaultCrf: 20,
    },
    storage: {
      metadataDirectory: `${homeDir}/.ink/metadata`,
      plansDirectory: `${homeDir}/.ink/plans`,
    },
  };
}

// ============================================================================
// Identification
// ============================================================================

export * from './identify';
