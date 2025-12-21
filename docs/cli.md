# Ink CLI Reference

## Overview

The `ink` CLI is the primary interface for interacting with the Ink DVD backup system. It communicates with the Ink daemon to manage disc metadata collection, plan creation, and backup execution.

## Commands

### Daemon Management

#### `ink daemon status`
Check if the daemon is running and display its status.

```bash
$ ink daemon status
Daemon: Running (PID 12345)
Uptime: 2 days, 3 hours
Active jobs: 2
```

#### `ink daemon start`
Start the Ink daemon.

```bash
$ ink daemon start
Starting Ink daemon...
Daemon started successfully (PID 12345)
```

#### `ink daemon stop`
Stop the Ink daemon.

```bash
$ ink daemon stop
Stopping Ink daemon...
Daemon stopped successfully
```

#### `ink daemon logs`
Show daemon logs.

```bash
$ ink daemon logs
# Optional flags:
--follow, -f    # Follow log output
--lines, -n     # Number of lines to show (default: 50)
```

---

### Metadata Management

#### `ink scan`
Trigger a manual scan for the currently inserted disc. Extracts metadata and saves to the metadata library.

```bash
$ ink scan
Scanning disc...
Found: THE_MATRIX (hash: abc123def456)
Extracting metadata...
Metadata saved to library

Tracks found:
  1. Main Feature (02:16:23) - 1920x1080
  2. Commentary Track (02:16:23) - 1920x1080
  3. Deleted Scenes (00:12:34) - 1920x1080
```

#### `ink metadata list`
List all collected disc metadata in the library.

```bash
$ ink metadata list
Collected metadata for 5 discs:

  abc123def456  The Matrix           3 tracks  2025-12-10
  def456789abc  Inception            2 tracks  2025-12-11
  789abcdef123  The Dark Knight      4 tracks  2025-12-12
  ...

Use 'ink metadata show <disc-id>' for details
```

#### `ink metadata show <disc-id>`
Show detailed metadata for a specific disc.

```bash
$ ink metadata show abc123def456

Disc: The Matrix
Hash: abc123def456
Volume Label: THE_MATRIX
Scanned: 2025-12-10 14:23:10

Tracks:
  Track 1: Main Feature
    Duration: 02:16:23
    Size: 7.2 GB
    Video: 1920x1080, H.264
    Audio:
      - English (AC3 5.1)
      - Spanish (AC3 5.1)
      - French (AC3 5.1)
    Subtitles:
      - English
      - Spanish
      - French

  Track 2: Commentary Track
    Duration: 02:16:23
    Size: 6.8 GB
    ...
```

#### `ink metadata delete <disc-id>`
Delete metadata for a specific disc from the library.

```bash
$ ink metadata delete abc123def456
Are you sure you want to delete metadata for 'The Matrix'? (y/n): y
Metadata deleted successfully
```

---

### Plan Management

#### `ink plan create`
Create a new backup plan interactively (future feature).

```bash
$ ink plan create
# Interactive wizard for creating a plan
```

#### `ink plan import <plan-file>`
Import a plan from a JSON file.

```bash
$ ink plan import matrix-plan.json
Plan imported successfully for disc: abc123def456
```

#### `ink plan export <disc-id>`
Export metadata for a disc as a plan template.

```bash
$ ink plan export abc123def456 > matrix-plan.json
Plan template exported
```

#### `ink plan list`
List all backup plans.

```bash
$ ink plan list
Available plans for 3 discs:

  abc123def456  The Matrix           2 tracks  Ready
  def456789abc  Inception            1 track   Ready
  789abcdef123  The Dark Knight      3 tracks  In Progress

Use 'ink plan show <disc-id>' for details
```

#### `ink plan show <disc-id>`
Show details of a specific backup plan.

```bash
$ ink plan show abc123def456

Plan: The Matrix
Disc ID: abc123def456
Created: 2025-12-10 15:00:00
Status: Ready

Tracks to backup:
  Track 1: Main Feature
    → The Matrix (1999).mkv
    Transcode: H.265, CRF 20, slow preset
    Audio: English (AAC), English (AC3)
    Subtitles: English
    Destination: /media/movies/The Matrix/

  Track 3: Deleted Scenes
    → The Matrix - Deleted Scenes.mkv
    Transcode: H.265, CRF 22, medium preset
    Audio: English (AAC)
    Destination: /media/movies/The Matrix/extras/
```

#### `ink plan edit <disc-id>`
Edit an existing plan (opens in default editor).

```bash
$ ink plan edit abc123def456
# Opens plan JSON in $EDITOR
```

#### `ink plan delete <disc-id>`
Delete a backup plan.

```bash
$ ink plan delete abc123def456
Are you sure you want to delete the plan for 'The Matrix'? (y/n): y
Plan deleted successfully
```

#### `ink plan validate <plan-file>`
Validate a plan file without importing it.

```bash
$ ink plan validate matrix-plan.json
✓ Plan file is valid
✓ Disc metadata exists in library
✓ All output directories are writable
```

---

### Job Management

#### `ink jobs list`
Show current and queued jobs.

```bash
$ ink jobs list

Active Jobs:
  job-001  Extracting  The Matrix - Track 1       45% (2.3 GB/s)
  job-002  Transcoding Inception - Track 1        12% (35 fps, ETA: 1h 23m)

Queued Jobs:
  job-003  Pending     The Matrix - Track 3       Waiting for extraction
  job-004  Pending     The Dark Knight - Track 1  Waiting for disc

Completed (recent):
  job-000  Completed   Blade Runner - Track 1     2025-12-12 14:30
```

#### `ink jobs status <job-id>`
Show detailed status for a specific job.

```bash
$ ink jobs status job-002

Job: job-002
Status: Transcoding
Disc: Inception (def456789abc)
Track: 1 - Main Feature
Started: 2025-12-12 15:00:00

Current Stage: Transcode
Progress: 12% (ETA: 1h 23m)
Speed: 35 fps
Output: /tmp/ink-staging/job-002/output.mkv
Size: 1.2 GB (estimated final: 3.8 GB)

Stages:
  ✓ Extract    Completed (15:00 - 15:12)
  → Transcode  In Progress (15:12 - ?)
  ⋯ Finalize   Pending
```

#### `ink jobs cancel <job-id>`
Cancel a running or queued job.

```bash
$ ink jobs cancel job-002
Are you sure you want to cancel this job? (y/n): y
Job cancelled successfully
```

#### `ink jobs retry <job-id>`
Retry a failed job.

```bash
$ ink jobs retry job-002
Retrying job job-002...
Job queued successfully
```

#### `ink jobs clear`
Clear completed job history.

```bash
$ ink jobs clear
# Optional flags:
--failed    # Clear only failed jobs
--all       # Clear all completed jobs
```

---

### Configuration

#### `ink config list`
Show all configuration settings.

```bash
$ ink config list
Configuration:

Daemon:
  auto_start: true
  auto_execute_plans: false
  notify_on_plan_ready: true

Extraction:
  staging_directory: /tmp/ink-staging
  keep_raw_mkv: false

Transcoding:
  concurrent_jobs: 2 (default: 1 per 4 cores)
  default_preset: slow
  default_crf: 20

Storage:
  metadata_directory: ~/.ink/metadata
  plans_directory: ~/.ink/plans
```

#### `ink config get <key>`
Get a specific configuration value.

```bash
$ ink config get transcoding.concurrent_jobs
2
```

#### `ink config set <key> <value>`
Set a configuration value.

```bash
$ ink config set transcoding.concurrent_jobs 4
Configuration updated: transcoding.concurrent_jobs = 4
```

#### `ink config reset`
Reset configuration to defaults.

```bash
$ ink config reset
Are you sure you want to reset all configuration to defaults? (y/n): y
Configuration reset successfully
```

---

### Statistics & Information

#### `ink stats`
Show system statistics.

```bash
$ ink stats

Library Statistics:
  Metadata collected: 15 discs
  Plans created: 12 plans
  Plans pending: 5

Job Statistics:
  Total jobs completed: 47
  Total jobs failed: 2
  Success rate: 95.9%
  Total data processed: 234.5 GB
  Total transcoded: 189.2 GB

Current Status:
  Active jobs: 2
  Queued jobs: 3
  Transcode queue: 1 pending
```

#### `ink version`
Show version information.

```bash
$ ink version
Ink DVD Backup System
Version: 0.1.0
Daemon: Running (v0.1.0)
Platform: macOS 14.2
```

---

## Global Flags

```bash
--help, -h       Show help
--version, -v    Show version
--json           Output in JSON format (where applicable)
--verbose        Verbose output
--quiet, -q      Suppress non-essential output
```

---

## Configuration File

Configuration is stored in `~/.ink/config.json` and can be edited directly or via `ink config` commands.

Example configuration:

```json
{
  "daemon": {
    "auto_start": true,
    "auto_execute_plans": false,
    "notify_on_plan_ready": true,
    "port": 3142
  },
  "extraction": {
    "staging_directory": "/tmp/ink-staging",
    "keep_raw_mkv": false
  },
  "transcoding": {
    "concurrent_jobs": 2,
    "default_codec": "h265",
    "default_preset": "slow",
    "default_crf": 20
  },
  "storage": {
    "metadata_directory": "~/.ink/metadata",
    "plans_directory": "~/.ink/plans"
  }
}
```

---

## Workflow Examples

### Collecting Metadata from Multiple Discs

```bash
# Insert first disc
$ ink scan
Found: THE_MATRIX (hash: abc123)
Metadata saved

# Eject, insert second disc
$ ink scan
Found: INCEPTION (hash: def456)
Metadata saved

# View collected metadata
$ ink metadata list
```

### Creating and Executing a Plan

```bash
# Export metadata as plan template
$ ink plan export abc123 > matrix.json

# Edit the plan file
$ vim matrix.json

# Import the plan
$ ink plan import matrix.json

# Insert the disc - daemon will detect and prompt
# Or manually trigger if disc is already inserted
$ ink jobs list

# Monitor progress
$ ink jobs status job-001
```

### Monitoring Active Jobs

```bash
# Check all jobs
$ ink jobs list

# Follow specific job
$ watch -n 1 ink jobs status job-001

# View daemon logs
$ ink daemon logs --follow
```
