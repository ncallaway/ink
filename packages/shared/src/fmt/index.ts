import chalk from "chalk";
import { TrackQueue, TrackQueueStatus, TrackStatus } from "../types";

const duration = (ms: number): string => {
  if (ms < 0) return '0s';

  const seconds = Math.floor((ms / 1000) % 60);
  const minutes = Math.floor((ms / (1000 * 60)) % 60);
  const hours = Math.floor((ms / (1000 * 60 * 60)));

  const parts = [];
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  parts.push(`${seconds}s`);

  return parts.join(' ');
}

const eta = (startTime: number, percentage: number): string => {
  if (percentage <= 0 || percentage >= 100) return '--';

  const elapsed = Date.now() - startTime;
  const totalEstimated = elapsed / (percentage / 100);
  const remaining = totalEstimated - elapsed;

  return duration(remaining);
}

export const fmt = {
  trackStatus: (s: TrackStatus) => {
    switch(s) {
      case 'error': return chalk.red('ERROR');
      case 'running': return chalk.white('RUNNING');
      case 'ready': return chalk.white('READY');
      case 'complete': return chalk.green('DONE');
      case 'ignored': return chalk.gray('IGNORED');
    }
  },

  trackQueue: (q: TrackQueue) => {
    switch(q) {
      case 'extract': return 'Extract';
      case 'transcode': return 'Encode';
      case 'review': return 'Review';
      case 'copy': return 'Copy';
    }
  },

  trackQueueStatus: (q: TrackQueue, status: TrackQueueStatus): string => {
    const f = `[${fmt.trackQueue(q)}]`;
    switch(status) {
      case 'ineligible': return chalk.gray(chalk.strikethrough(f));
      case 'error': return chalk.red(f);
      case 'ready': return chalk.white(f);
      case 'running': return chalk.bgWhite(chalk.green(f));
      case 'done': return chalk.green(f);
      case 'blocked': return chalk.gray(f);
    }
  },

  duration,
  eta
}
