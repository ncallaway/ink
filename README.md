# Ink - DVD Backup System

A comprehensive DVD backup system that streamlines the process of archiving DVD collections through efficient two-phase workflows.

## Project Structure

```
ink/
├── packages/
│   ├── daemon/          # Background service
│   ├── cli/             # Command-line interface
│   └── shared/          # Shared types and utilities
└── docs/                # Documentation
    ├── plan.md          # High-level project overview
    └── cli.md           # CLI command reference
```

## Prerequisites

- [Bun](https://bun.sh) runtime
- `makemkvcon` - DVD extraction tool
- `ffmpeg` - Video transcoding
- `libdvdcss` - DVD decryption (system library)

### Installing Dependencies

**macOS:**
```bash
brew install makemkv ffmpeg libdvdcss
```

**Linux (Ubuntu/Debian):**
```bash
sudo apt install makemkv-bin makemkv-oss ffmpeg libdvdcss2
```

## Getting Started

### 1. Install Dependencies

```bash
bun install
```

### 2. Build All Packages

```bash
bun run build
```

### 3. Development

To work on individual packages:

```bash
# Run daemon in development mode
cd packages/daemon
bun run dev

# Run CLI in development mode
cd packages/cli
bun run dev
```

## Package Overview

### @ink/daemon

Background service that handles:
- Disc detection and monitoring
- Metadata extraction with `makemkvcon`
- Job queue management
- Extraction and transcoding pipeline
- HTTP API server for CLI communication

**Entry Point:** `packages/daemon/src/index.ts`

### @ink/cli

Command-line interface providing commands for:
- Daemon management (start, stop, status)
- Metadata collection and management
- Plan creation, import, and export
- Job monitoring and control
- Configuration management

**Entry Point:** `packages/cli/src/index.ts`

See [docs/cli.md](./docs/cli.md) for complete command reference.

### @ink/shared

Common library containing:
- TypeScript types and interfaces
- Shared schemas (metadata, plans, jobs, config)
- Utility functions
- API protocol definitions

**Entry Point:** `packages/shared/src/index.ts`

## Workflow Overview

### Phase 1: Metadata Collection
1. Insert DVD
2. Run `ink scan` to extract metadata
3. Metadata saved to library
4. Repeat with next disc

### Phase 2: Plan Creation
1. Browse collected metadata
2. Create backup plans (JSON files)
3. Specify tracks, transcoding settings, outputs

### Phase 3: Automatic Execution
1. Insert DVD with existing plan
2. Daemon auto-executes backup
3. Extraction → Transcoding → Finalization
4. Pipeline allows disc swapping during transcoding

See [docs/plan.md](./docs/plan.md) for detailed workflow information.

## Configuration

Default configuration location: `~/.ink/config.json`

Example configuration:
```json
{
  "daemon": {
    "autoStart": true,
    "autoExecutePlans": false,
    "notifyOnPlanReady": true,
    "port": 3142
  },
  "extraction": {
    "stagingDirectory": "/tmp/ink-staging",
    "keepRawMkv": false
  },
  "transcoding": {
    "concurrentJobs": 2,
    "defaultCodec": "h265",
    "defaultPreset": "slow",
    "defaultCrf": 20
  },
  "storage": {
    "metadataDirectory": "~/.ink/metadata",
    "plansDirectory": "~/.ink/plans"
  }
}
```

Use `ink config` commands to manage configuration.

## Development Scripts

```bash
# Build all packages
bun run build

# Run in development mode (all packages)
bun run dev

# Type checking
bun run typecheck

# Clean build artifacts
bun run clean
```

## Project Status

This project is in early development. The monorepo structure and entry points are set up, but core functionality is not yet implemented.

### TODO
- [ ] Implement disc detection (macOS/Linux)
- [ ] Integrate makemkvcon for metadata extraction
- [ ] Implement plan management
- [ ] Build job queue system
- [ ] Integrate ffmpeg for transcoding
- [ ] Add progress tracking
- [ ] Implement daemon installation scripts (launchd/systemd)
- [ ] Add WebSocket support for real-time updates
- [ ] Comprehensive testing

## Documentation

- [High-Level Plan](./docs/plan.md) - Architecture, workflow, and design principles
- [CLI Reference](./docs/cli.md) - Complete command documentation

## Platform Support

- **macOS** - Primary development platform
- **Linux** - Planned support

Both platforms are supported through platform-specific implementations for:
- Disc detection (diskutil vs udev)
- Daemon management (launchd vs systemd)
- Device paths (/dev/rdisk* vs /dev/sr*)

## License

TBD
