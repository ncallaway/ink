#!/usr/bin/env bun

/**
 * Ink Daemon - DVD Backup System Background Service
 * 
 * This daemon runs in the background and handles:
 * - Disc detection and monitoring
 * - Metadata extraction with makemkvcon
 * - Job queue management
 * - Extraction and transcoding pipeline
 * - HTTP API server for CLI communication
 */

import { Hono } from 'hono';

const app = new Hono();

// API Routes
app.get('/api/status', (c) => {
  return c.json({
    status: 'running',
    version: '0.1.0',
    uptime: process.uptime(),
  });
});

app.get('/api/metadata', (c) => {
  // TODO: Implement metadata listing
  return c.json({ metadata: [] });
});

app.get('/api/plans', (c) => {
  // TODO: Implement plan listing
  return c.json({ plans: [] });
});

app.get('/api/jobs', (c) => {
  // TODO: Implement job listing
  return c.json({ jobs: [] });
});

app.get('/api/config', (c) => {
  // TODO: Implement config retrieval
  return c.json({ config: {} });
});

const DEFAULT_PORT = 3142;

console.log('🎬 Ink Daemon starting...');
console.log(`📡 API server listening on http://localhost:${DEFAULT_PORT}`);

export default {
  port: DEFAULT_PORT,
  fetch: app.fetch,
};
