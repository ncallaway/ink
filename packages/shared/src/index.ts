/**
 * Ink Shared Library
 * 
 * Common types, schemas, and utilities used across the Ink system
 */

import { disc } from './disc';
import { drive } from './drive';
import { InkConfig } from './types';

export * from './types';

export const lib = {
  disc,
  drive
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

