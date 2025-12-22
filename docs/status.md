# Project Status

## Finished
- **Core Structure**: Monorepo setup with `@ink/cli`, `@ink/daemon`, and `@ink/shared`.
- **Disc Identification**:
  - Implemented universal disc identification strategy (DVD IFO hash / Blu-ray BDMV hash).
  - Implemented fast-path caching using unique disc ID.
  - Added safe mounting via `udisksctl`.
- **Metadata Collection (`ink metadata read`)**:
  - Auto-detection of drives.
  - Robust parsing of `makemkvcon` output (TINFO/SINFO).
  - Capturing of all tracks (no minimum duration filter).
  - Metadata storage in `~/.ink/metadata`.
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
  - Extraction implementation (`makemkvcon mkv`).
  - Transcoding implementation (`ffmpeg`).
  - Pipeline orchestration (extract -> transcode).
- **CLI Commands**:
  - `ink scan` (wrapper for read).
  - `ink status`.
  - `ink jobs`.

## Deviations from Plan
- **Disc ID Strategy**: Moved from simple Volume Label/UUID to a more robust IFO/BDMV content hash (Kodi-style) to ensure unique identification even for same-label discs, while maintaining speed.
- **Metadata Filtering**: Decided to capture *all* tracks (using `--minlength=0`) during the read phase and defer filtering decisions to the planning phase, rather than letting MakeMKV filter arbitrarily.
