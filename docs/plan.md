# Ink - DVD Backup System

## Overview

Ink is a comprehensive DVD backup system designed to streamline the process of archiving DVD collections. It separates the traditionally time-consuming process into efficient phases, allowing users to quickly collect metadata from multiple discs, plan backups at their convenience, and then execute those plans automatically when discs are re-inserted.

## Key Features

- **Two-Phase Workflow**: Separate metadata collection from actual backup execution
- **Automatic Execution**: Plans execute automatically when planned discs are inserted
- **Pipelined Processing**: Extraction and transcoding run in parallel for maximum efficiency
- **Cross-Platform**: Supports both macOS and Linux
- **Daemon Architecture**: Background service handles all heavy lifting
- **User-Friendly CLI**: Simple, intuitive command-line interface

## Architecture

### Components

1. **Daemon** (`ink-daemon`)
   - Long-running background service
   - Monitors for disc insertion events
   - Manages extraction and transcoding pipelines
   - Exposes HTTP API for CLI communication
   - Handles job queue and execution

2. **CLI** (`ink`)
   - User-facing command-line interface
   - Communicates with daemon via HTTP API
   - Provides commands for metadata, plans, jobs, and configuration
   - Displays real-time progress and status

3. **Shared Library** (`@ink/shared`)
   - Common types and schemas
   - Shared utilities
   - API protocol definitions

### External Dependencies

- **makemkvcon**: DVD extraction and metadata reading
- **ffmpeg**: Video transcoding
- **libdvdcss**: DVD decryption (system library)

### Platform-Specific Components

**macOS:**
- `launchd` service for daemon management
- `diskutil` for disc detection
- `/dev/rdisk*` device paths

**Linux:**
- `systemd` service for daemon management
- `udev` for disc detection
- `/dev/sr*` device paths

## Workflow

### Phase 1: Metadata Collection

The first phase allows users to quickly build a library of disc metadata without performing any actual extraction.

1. User inserts DVD into drive
2. User runs `ink scan` (or daemon auto-detects if configured)
3. System uses `makemkvcon info` to extract disc metadata:
   - Disc hash (unique identifier)
   - Volume label
   - Track information (duration, size, format)
   - Audio track details (language, codec, channels)
   - Subtitle track details (language)
   - Chapter information
4. User provides a human-readable name for the disc
5. Metadata saved to `~/.ink/metadata/{disc-hash}.json`
6. User ejects disc and repeats with next disc

**Benefits:**
- Process multiple discs quickly (< 1 minute per disc)
- No need to wait for lengthy extraction/transcoding
- Build complete library metadata before planning backups

### Phase 2: Plan Creation

Once metadata is collected, users create backup plans. For TV Shows, this process is specialized to handle multi-disc seasons.

**Standard Season Workflow:**
1.  User selects "TV Show" -> "Standard Season".
2.  User searches for Show (via IMDB ID).
3.  User enters **Season Number** and **Disc Number**.
4.  Plan is saved with this structural info (`imdbId`, `season`, `disc`).
5.  *Note:* Exact episode mapping is NOT required at this stage.

**Compilation Workflow (e.g., "Best of"):**
1.  User selects "TV Show" -> "Compilation".
2.  User searches for Show.
3.  User manually maps specific tracks to specific episodes using a search interface.

### Phase 3: Automatic Execution

Execution is decoupled into processing and finalization to allow out-of-order processing.

1.  **Extraction**: Rips tracks to `staging/[disc-id]/extracted/tXX.mkv`.
2.  **Transcode**: Encodes to `staging/[disc-id]/encoded/tXX.mkv`.
    *   Files remain named by track number.
    *   Processing can happen regardless of whether previous discs in the season are known.

### Phase 4: Verification & Finalization (New)

A new **Verification Queue** manages the final move to the library.

1.  **Dependency Check**:
    *   System checks if all previous discs in the season have plans (to calculate episode offsets).
    *   If Disc 1 is missing, Disc 2 sits in "Blocked" state (files are ready, just waiting for name).
2.  **Episode Mapping**:
    *   Once the chain is complete, system calculates episode numbers (e.g., Disc 2 Track 1 = Episode 5).
    *   System uses TVMaze API (lookup via IMDB ID) to validate counts.
3.  **User Review (`ink verify`)**:
    *   User is presented with the calculated mapping.
    *   User can spot-check video files.
    *   User approves the batch.
4.  **Finalize**:
    *   Files renamed to: `series/[Show Name] ([Year])/[Show Name] - S[S]E[E].mkv`
    *   Moved to final destination.

## Pipelined Processing

When a disc with an associated plan is inserted, the daemon automatically executes the backup process through multiple pipelined stages.

1. **Detection**: Daemon detects disc insertion
2. **Plan Lookup**: Daemon checks for existing plan using disc hash
3. **User Notification**: 
   - If `auto_execute_plans` is `false`: Notify user with option to start/cancel
   - If `auto_execute_plans` is `true`: Auto-start and notify user of execution
4. **Execution Pipeline**:
   - **Stage 1: Extraction**
     - Use `makemkvcon` to extract selected tracks to staging directory
     - Monitor progress (percentage, speed, ETA)
     - Each track becomes a separate job
   - **Stage 2: Queue Transcoding**
     - Extracted MKV files queued for transcoding
     - Queue processed by configurable number of workers
   - **Stage 3: Transcoding**
     - Use `ffmpeg` to transcode per plan specifications
     - Monitor progress (percentage, FPS, ETA)
     - Multiple transcode jobs can run in parallel
   - **Stage 4: Finalization**
     - Move completed files to final destination
     - Cleanup staging directory
     - Mark job as complete

**Benefits:**
- Fully automated once plan is created
- Hands-off execution
- Pipeline allows disc swapping while encoding continues
- Efficient use of CPU during extraction phases

## Pipelined Processing

A key feature of Ink is its ability to pipeline operations for maximum efficiency:

```
Time →

Disc 1: [Extract] → [Transcode ────────]
Disc 2:    [Extract] → [Transcode ────────]
Disc 3:       [Extract] → [Transcode ────────]
```

**How it works:**
1. Extraction is typically faster than transcoding (especially with high-quality settings)
2. After extracting from Disc 1, user can eject and insert Disc 2
3. While Disc 1's files are transcoding in the background, Disc 2 is being extracted
4. Transcoding queue builds up and processes files with configurable concurrency
5. Users can continue inserting planned discs as fast as extraction completes

**Concurrency Configuration:**
- Default: 1 transcode job per 4 CPU cores
- User-configurable via `ink config set transcoding.concurrent_jobs N`
- Extraction happens independently of transcode concurrency

## Data Storage

### Directory Structure

```
~/.ink/
├── config.json              # User configuration
├── metadata/                # Collected disc metadata
│   ├── abc123def456.json
│   ├── def456789abc.json
│   └── ...
├── plans/                   # Backup plans
│   ├── abc123def456.json
│   ├── def456789abc.json
│   └── ...
└── jobs.db                  # Job history (SQLite)

/tmp/ink-staging/            # Temporary extraction staging
├── job-001/
│   ├── track-01.mkv
│   └── output.mkv
└── job-002/
    └── ...
```

### Metadata File Format

```json
{
  "discId": "abc123def456",
  "volumeLabel": "THE_MATRIX",
  "userProvidedName": "The Matrix",
  "scannedAt": "2025-12-12T10:30:00Z",
  "tracks": [
    {
      "trackNumber": 1,
      "title": "Main Feature",
      "duration": "02:16:23",
      "size": 7234560000,
      "video": {
        "width": 1920,
        "height": 1080,
        "codec": "h264",
        "framerate": 23.976
      },
      "audio": [
        {
          "index": 0,
          "language": "eng",
          "codec": "ac3",
          "channels": 6,
          "title": "English (5.1)"
        }
      ],
      "subtitles": [
        {
          "index": 0,
          "language": "eng",
          "title": "English"
        }
      ],
      "chapters": 28
    }
  ]
}
```

### Plan File Format

*(Format to be finalized - deferred decision)*

Plan files will extend metadata with user choices:
- Selected tracks
- Transcoding configuration
- Output naming and destinations
- Audio/subtitle track selection

## Communication Protocol

### Daemon API (HTTP)

The daemon exposes a REST API on `localhost` (default port: 3142):

**Endpoints:**
- `GET /api/status` - Daemon status
- `GET /api/metadata` - List all metadata
- `GET /api/metadata/:discId` - Get specific metadata
- `POST /api/metadata/scan` - Trigger disc scan
- `GET /api/plans` - List all plans
- `GET /api/plans/:discId` - Get specific plan
- `POST /api/plans` - Import plan
- `DELETE /api/plans/:discId` - Delete plan
- `GET /api/jobs` - List jobs
- `GET /api/jobs/:jobId` - Get job status
- `POST /api/jobs/:jobId/cancel` - Cancel job
- `GET /api/config` - Get configuration
- `PATCH /api/config` - Update configuration

**WebSocket (Optional):**
- `WS /api/jobs/:jobId/progress` - Real-time job progress updates

### CLI Communication

The CLI communicates with the daemon exclusively via HTTP API:
1. CLI sends HTTP request to `localhost:3142`
2. Daemon processes request
3. Daemon returns JSON response
4. CLI formats and displays to user

## Job State Machine

Jobs progress through the following states:

```
pending → extracting → transcoding → finalizing → completed
                ↓           ↓            ↓
              failed      failed       failed
                ↓           ↓            ↓
              retrying    retrying     retrying
```

**States:**
- `pending`: Job created, waiting for disc or resources
- `extracting`: makemkvcon is running
- `transcoding`: ffmpeg is running
- `finalizing`: Moving files, cleanup
- `completed`: Successfully finished
- `failed`: Error occurred
- `retrying`: Automatic or manual retry in progress
- `cancelled`: User cancelled

## Configuration

### Daemon Configuration

- `auto_start`: Start daemon on system boot (default: `true`)
- `auto_execute_plans`: Automatically execute plans when disc inserted (default: `false`)
- `notify_on_plan_ready`: Send system notification when planned disc is detected (default: `true`)
- `port`: HTTP API port (default: `3142`)

### Extraction Configuration

- `staging_directory`: Temporary storage for extracted files (default: `/tmp/ink-staging`)
- `keep_raw_mkv`: Keep extracted MKV files after transcoding (default: `false`)

### Transcoding Configuration

- `concurrent_jobs`: Number of parallel transcode jobs (default: CPU cores / 4)
- `default_codec`: Default video codec (default: `h265`)
- `default_preset`: Default ffmpeg preset (default: `slow`)
- `default_crf`: Default CRF quality (default: `20`)

## Installation

### macOS

```bash
# Install dependencies
brew install makemkv ffmpeg libdvdcss

# Install Ink
bun install -g @ink/cli

# Install daemon
ink daemon install
```

### Linux

```bash
# Install dependencies (Ubuntu/Debian)
sudo apt install makemkv-bin makemkv-oss ffmpeg libdvdcss2

# Install Ink
bun install -g @ink/cli

# Install daemon
ink daemon install
```

## Development Roadmap

### Phase 1: Foundation (MVP)
- [ ] Monorepo structure with Bun workspaces
- [ ] Daemon basic HTTP server
- [ ] CLI basic commands
- [ ] Disc detection (macOS)
- [ ] Metadata extraction with makemkvcon
- [ ] Metadata storage

### Phase 2: Plan Management
- [ ] Plan file schema (finalize format)
- [ ] Plan import/export
- [ ] Plan validation
- [ ] Interactive plan creation wizard

### Phase 3: Execution Pipeline
- [x] makemkvcon integration (extraction)
- [x] ffmpeg integration (transcoding)
- [ ] Job queue system
- [ ] Pipelined execution
- [ ] Progress tracking
- [ ] Job state management
- [ ] **Optimization**: Parallel transcoding (run multiple ffmpeg jobs)
- [ ] **Cleanup Queue**: Automatically delete staging files for tracks copied >7 days ago.

### Phase 4: Polish
- [ ] System notifications
- [ ] WebSocket progress streaming
- [ ] Error handling and retry logic
- [ ] Statistics and reporting
- [ ] Linux support
- [ ] Comprehensive testing

### Phase 5: UI (Future)
- [ ] Web-based UI
- [ ] Plan creation interface
- [ ] Real-time job monitoring
- [ ] Library browser

## Technology Stack

### Core
- **Runtime**: Bun
- **Language**: TypeScript
- **Monorepo**: Bun workspaces

### Daemon
- **Web Framework**: Hono (lightweight, fast)
- **Database**: better-sqlite3 (job history)
- **Process Management**: Node.js child_process

### CLI
- **Argument Parsing**: commander
- **Terminal UI**: chalk, ora, cli-table3
- **HTTP Client**: Built-in fetch

### External Tools
- **makemkvcon**: DVD extraction and metadata
- **ffmpeg**: Video transcoding
- **libdvdcss**: DVD decryption (system library)

## Design Principles

1. **User Efficiency First**: Optimize for bulk processing workflows
2. **Separation of Concerns**: Clear phases (metadata → planning → execution)
3. **Non-Blocking**: Never wait unnecessarily (pipeline everything)
4. **Transparency**: Always show what's happening and why
5. **Fail Gracefully**: Clear error messages, easy retry mechanisms
6. **Configuration Over Convention**: User control when it matters
7. **Platform Agnostic**: Abstract platform differences cleanly

## Success Metrics

- **Metadata collection**: < 60 seconds per disc
- **Plan creation**: < 5 minutes per disc (user time)
- **Pipeline efficiency**: Extract next disc while previous transcodes
- **Resource usage**: Configurable CPU usage for transcoding
- **Reliability**: Jobs can be interrupted and resumed
- **User experience**: Clear status, progress, and error messages
