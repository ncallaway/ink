#!/usr/bin/env bun

/**
 * Ink CLI - DVD Backup System Command-Line Interface
 * 
 * This CLI provides commands for:
 * - Daemon management (start, stop, status)
 * - Metadata collection and management
 * - Plan creation, import, and export
 * - Job monitoring and control
 * - Configuration management
 */

import { Command } from 'commander';
import { defineCommand as defineMetadata } from './commands/metadata';

const program = new Command();

program
  .name('ink')
  .description('DVD backup system with metadata collection and automated execution')
  .version('0.1.0');

// Daemon commands
const daemon = program.command('daemon').description('Manage the Ink daemon');

daemon
  .command('status')
  .description('Check daemon status')
  .action(() => {
    console.log('TODO: Implement daemon status');
  });

daemon
  .command('start')
  .description('Start the daemon')
  .action(() => {
    console.log('TODO: Implement daemon start');
  });

daemon
  .command('stop')
  .description('Stop the daemon')
  .action(() => {
    console.log('TODO: Implement daemon stop');
  });

daemon
  .command('logs')
  .description('Show daemon logs')
  .option('-f, --follow', 'Follow log output')
  .option('-n, --lines <number>', 'Number of lines to show', '50')
  .action(() => {
    console.log('TODO: Implement daemon logs');
  });


defineMetadata(program);

// Scan command (top-level)
program
  .command('scan')
  .description('Scan currently inserted disc for metadata')
  .action(() => {
    console.log('TODO: Implement disc scan');
  });

// Plan commands
const plan = program.command('plan').description('Manage backup plans');

plan
  .command('list')
  .description('List all backup plans')
  .action(() => {
    console.log('TODO: Implement plan list');
  });

plan
  .command('show <disc-id>')
  .description('Show details of a specific plan')
  .action((discId) => {
    console.log(`TODO: Show plan for ${discId}`);
  });

plan
  .command('import <plan-file>')
  .description('Import a plan from a JSON file')
  .action((planFile) => {
    console.log(`TODO: Import plan from ${planFile}`);
  });

plan
  .command('export <disc-id>')
  .description('Export metadata as a plan template')
  .action((discId) => {
    console.log(`TODO: Export plan template for ${discId}`);
  });

plan
  .command('delete <disc-id>')
  .description('Delete a backup plan')
  .action((discId) => {
    console.log(`TODO: Delete plan for ${discId}`);
  });

plan
  .command('validate <plan-file>')
  .description('Validate a plan file')
  .action((planFile) => {
    console.log(`TODO: Validate plan file ${planFile}`);
  });

// Job commands
const jobs = program.command('jobs').description('Manage backup jobs');

jobs
  .command('list')
  .description('Show current and queued jobs')
  .action(() => {
    console.log('TODO: Implement jobs list');
  });

jobs
  .command('status <job-id>')
  .description('Show detailed status for a specific job')
  .action((jobId) => {
    console.log(`TODO: Show status for job ${jobId}`);
  });

jobs
  .command('cancel <job-id>')
  .description('Cancel a running or queued job')
  .action((jobId) => {
    console.log(`TODO: Cancel job ${jobId}`);
  });

jobs
  .command('retry <job-id>')
  .description('Retry a failed job')
  .action((jobId) => {
    console.log(`TODO: Retry job ${jobId}`);
  });

jobs
  .command('clear')
  .description('Clear completed job history')
  .option('--failed', 'Clear only failed jobs')
  .option('--all', 'Clear all completed jobs')
  .action(() => {
    console.log('TODO: Implement jobs clear');
  });

// Config commands
const config = program.command('config').description('Manage configuration');

config
  .command('list')
  .description('Show all configuration settings')
  .action(() => {
    console.log('TODO: Implement config list');
  });

config
  .command('get <key>')
  .description('Get a specific configuration value')
  .action((key) => {
    console.log(`TODO: Get config value for ${key}`);
  });

config
  .command('set <key> <value>')
  .description('Set a configuration value')
  .action((key, value) => {
    console.log(`TODO: Set config ${key} = ${value}`);
  });

config
  .command('reset')
  .description('Reset configuration to defaults')
  .action(() => {
    console.log('TODO: Implement config reset');
  });

// Stats command
program
  .command('stats')
  .description('Show system statistics')
  .action(() => {
    console.log('TODO: Implement stats');
  });

program.parse();
