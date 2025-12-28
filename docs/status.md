# Project Status

## Finished
- **Core Structure**: Monorepo setup with `@ink/cli`, `@ink/daemon`, and `@ink/shared`.
- **Disc Identification**:
  - Implemented universal disc identification strategy (DVD IFO hash / Blu-ray BDMV hash).
  - Implemented fast-path caching using unique disc ID.
  - Added safe mounting via `udisksctl`.
- **Drive Utilities**:
  - Implemented low-level drive status detection (`ioctl` on Linux) to detect tray state (Empty, Open, Reading, Disk Present).
  - Implemented `listDrives` for OS-level hardware enumeration.
  - Added smart polling to wait for drives to spin up (`READING` -> `DISK_PRESENT`).
- **Metadata Collection (`ink metadata read`)**:
  - Auto-detection of drives using OS enumeration.
  - Mapping of OS device paths (e.g., `/dev/sr0`) to MakeMKV drive indices.
  - Robust parsing of `makemkvcon` output (TINFO/SINFO).
  - **Interactive Workflow**:
    - Waits for drive to be ready.
    - Scans metadata.
    - Saves provisional metadata.
    - Prompts user for a custom disc name.
    - Updates metadata with user input.
- **Metadata Management**:
  - `ink metadata list`: List collected metadata with sorting (`--order`) and filtering (`--status`).
  - `ink metadata show`: Display detailed info for a specific disc.
  - `ink metadata delete`: Remove metadata.
- **Shared Utilities**:
  - Result type (`neverthrow`) for robust error handling.
  - Typed metadata schemas in `@ink/shared`.

## Remaining
- **Daemon Implementation**:
  - Monitoring for disc insertion.
  - HTTP API implementation.
  - Job queue and state machine.
- **Plan Management**:
  - `ink plan export/import` commands.
  - Plan file schema finalization.
  - Filtering logic (e.g., min duration) during plan creation.
- **Execution Pipeline**:
  - `run extract` command implemented with:
    - Automatic drive scanning and plan lookup.
    - Idempotent track extraction to staging.
    - Robust `makemkvcon` robot mode parsing for progress and errors.
    - Detailed spinner with stage tracking (e.g. "Saving to MKV file").
  - `run transcode` command implemented with:
    - Automatic staging scan for extracted tracks.
    - FFmpeg integration (H.265/AAC default).
    - Real-time progress parsing (FPS, time, speed, percentage).
    - Status tracking via marker files.
  - **Plan Status**:
    - `plan list` and `plan show` now dynamically calculate status (`[Extracted]`, `[Encoded]`, `[Completed]`) based on the filesystem state.

## Remaining
- **Execution Pipeline**:
- **Execution Pipeline**:
  - `run copy` (Finalize): Move files to destination.
  - Parallel transcoding support (optimization).
- **Daemon Implementation**:
  - `ink scan` (wrapper for read).
  - `ink status`.
  - `ink jobs`.

## Deviations from Plan
- **Disc ID Strategy**: Moved from simple Volume Label/UUID to a more robust IFO/BDMV content hash (Kodi-style) to ensure unique identification even for same-label discs, while maintaining speed.
- **Metadata Filtering**: Decided to capture *all* tracks (using `--minlength=0`) during the read phase and defer filtering decisions to the planning phase, rather than letting MakeMKV filter arbitrarily.
- **Drive Detection**: Switched from relying solely on MakeMKV scan (which misses busy drives) to OS-level enumeration (`/dev/sr*`) combined with low-level status checks to robustly handle "spinning up" states.