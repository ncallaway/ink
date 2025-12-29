import chalk from "chalk";
import { TrackQueue, TrackQueueStatus, TrackStatus } from "../types";

export const fmt = {
  trackStatus: (s: TrackStatus) => {
    switch(s) {
      case 'error': return chalk.red('Error');
      case 'running': return chalk.white('Running');
      case 'ready': return chalk.white('Ready');
      case 'complete': return chalk.green('DONE');
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
  }
}
