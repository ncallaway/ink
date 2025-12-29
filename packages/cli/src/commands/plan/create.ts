import { Command } from "commander";
import * as fs from "fs/promises";
import * as path from "path";
import * as readline from "node:readline";
import chalk from "chalk";
import { select, input, checkbox, confirm } from "@inquirer/prompts";
import Fuse from "fuse.js";
import { DiscMetadata, BackupPlan, TrackMetadata, TrackPlan, lib, CandidateEpisode, DiscId, TrackNumber } from "@ink/shared";
import { 
    loadMetadata, 
    searchTvMaze, 
    getTvMazeEpisodes, 
    getTvMazeShowByImdbId,
    TvMazeShow, 
    TvMazeEpisode 
} from "../metadata/utils";
import { savePlan, loadPlan } from "./utils";
import { unwrapOrExit } from "../../utils/unwrap";

export const planCreate = (parent: Command) => {
  parent
    .command('create [disc-id]')
    .description('Create a new backup plan')
    .action(run);
}

async function run(discId?: DiscId) {
  let metadata: DiscMetadata | null = null;

  if (discId) {
    metadata = await loadMetadata(discId);
    if (!metadata) {
      console.error(chalk.red(`Metadata for disc ID '${discId}' not found.`));
      process.exit(1);
    }
  } else {
    metadata = await selectUnplannedDisc();
  }

  if (!metadata) return;

  // Initialize Draft Plan
  const plan: BackupPlan = {
    discId: metadata.discId,
    discLabel: metadata.userProvidedName || metadata.volumeLabel,
    title: metadata.userProvidedName || metadata.volumeLabel,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: 'draft',
    type: 'movie',
    tracks: []
  };

  await savePlan(plan);

  // 1. Select Type
  plan.type = await select({
    message: "What type of content is this?",
    choices: [
      { name: 'Movie', value: 'movie' },
      { name: 'TV Show', value: 'tv' }
    ]
  }) as 'movie' | 'tv';
  await savePlan(plan);

  let tvSubType: 'standard' | 'compilation' = 'standard';
  if (plan.type === 'tv') {
    tvSubType = await select({
      message: "Is this a standard season or a compilation disc?",
      choices: [
        { name: 'Standard Season', value: 'standard' },
        { name: 'Compilation', value: 'compilation' }
      ]
    }) as 'standard' | 'compilation';
  }

  // 2. Identify Title & Year
  let title = await input({
    message: "Enter the title:",
    default: plan.title
  });

  let year = "";
  let imdbId = "";
  let tvMazeId: number | undefined;

  console.log(chalk.blue("Searching IMDB..."));
  const results = await searchImdb(title);
  
  if (results.length > 0) {
    const choices = results.map(r => ({
      name: `${r.title} (${r.year}) [${r.type}]`,
      value: r
    }));
    choices.push({ name: "Enter manually...", value: null as any });

    const selected = await select({
      message: "Select the correct match:",
      choices: choices
    });

    if (selected) {
      title = selected.title;
      year = selected.year.toString();
      imdbId = selected.id;

      // If TV, resolve TVMaze ID
      if (plan.type === 'tv') {
          console.log(chalk.blue("Resolving TVMaze metadata..."));
          const tvMazeShow = await getTvMazeShowByImdbId(imdbId);
          if (tvMazeShow) {
              tvMazeId = tvMazeShow.id;
              title = tvMazeShow.name; // Use canonical TVMaze name
          }
      }
    }
  }

  if (!year) {
    year = await input({
      message: "Enter the release year (YYYY):",
      validate: (val) => /^\d{4}$/.test(val) ? true : "Please enter a valid 4-digit year."
    });
  }

  plan.title = title;
  plan.imdbId = imdbId;

  if (plan.type === 'tv') {
    plan.tvShow = {
      imdbId: imdbId,
      tvMazeId: tvMazeId,
      name: title,
      season: tvSubType === 'standard' ? 1 : 0,
      disc: tvSubType === 'standard' ? 1 : 0
    };
  }
  await savePlan(plan);

  // Handle TV Specific Inputs
  if (plan.type === 'tv' && tvSubType === 'standard') {
    const seasonStr = await input({ message: "Season Number:", default: "1" });
    const discStr = await input({ message: "Disc Number:", default: "1" });
    if (plan.tvShow) {
      plan.tvShow.season = parseInt(seasonStr) || 1;
      plan.tvShow.disc = parseInt(discStr) || 1;
    }
    await savePlan(plan);
  }

  if (plan.type === 'tv' && tvSubType === 'compilation' && tvMazeId) {
    console.log(chalk.blue("Fetching all episodes from TVMaze..."));
    const allEpisodes = await getTvMazeEpisodes(tvMazeId);
    
    console.log(chalk.yellow("\nPlease paste the list of episode names on this disc (one per line)."));
    console.log(chalk.gray("Press Enter twice or Ctrl+D (on a new line) when finished:"));
    
    const pastedList: string[] = [];
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    for await (const line of rl) {
        if (line.trim() === "") break;
        pastedList.push(line.trim());
    }

    if (pastedList.length > 0) {
        const candidates: CandidateEpisode[] = [];
        const fuse = new Fuse(allEpisodes, { keys: ['name'], threshold: 0.4 });

        for (const query of pastedList) {
            const results = fuse.search(query);
            if (results.length > 0) {
                const ep = results[0].item;
                candidates.push({
                    id: ep.id,
                    season: ep.season,
                    number: ep.number,
                    name: ep.name
                });
            }
        }
        plan.candidates = candidates;
        console.log(chalk.green(`Matched ${candidates.length} episodes out of ${pastedList.length} provided.`));
        await savePlan(plan);
    }
  }

  // 3. Duration Cut-off
  const cutoffMinutes = await selectDurationCutoff(metadata, plan.type);
  
  // 4. Destination Path
  let destination = "";
  if (plan.type === 'movie') {
    destination = 'movies/';
  } else {
    // Sanitize title for folder name but keep it readable
    const safeTitle = plan.title.replace(/[\\/:*?"<>|]/g, '');
    const defaultDest = path.join('series', `${safeTitle} (${year})`);
    
    destination = await input({
      message: "Enter the destination directory:",
      default: defaultDest
    });
  }

  // 5. Individual File Selection
  const selectedTrackIndices = await selectTracks(metadata, cutoffMinutes);
  if (selectedTrackIndices.length === 0) {
    console.log(chalk.yellow("No tracks selected. Exiting."));
    return;
  }

  // 6. Audio & Subtitle Configuration
  const trackConfig = await configureTracks(metadata, selectedTrackIndices);

  // 7. Naming Convention & Offset
  let pattern = "";
  let offset = 0;

  if (plan.type === 'movie') {
    // For movies, automatically use "Title (Year)"
    // If multiple tracks are selected, the generator will append _00, _01, etc.
    pattern = `${title} (${year})`;
  } else if (tvSubType === 'compilation' || tvSubType === 'standard') {
    // For both standard and compilations, defer naming to review step
    pattern = "Placeholder XX";
    offset = 1;
  } else {
    // Legacy/Manual Logic (fallback)
    if (selectedTrackIndices.length > 1) {
      pattern = await input({
        message: "Enter naming pattern (use 'XX' for track number):",
        default: `${plan.title} - S01EXX`
      });
      const offsetStr = await input({
        message: "Starting track offset:",
        default: "1"
      });
      offset = parseInt(offsetStr) || 0;
    } else {
      pattern = await input({
        message: "Enter filename:",
        default: plan.title
      });
    }
  }

  // Generate initial track plans
  plan.tracks = generateInitialTrackPlans(
      metadata, 
      selectedTrackIndices, 
      pattern, 
      offset, 
      destination,
      trackConfig
  );
  await savePlan(plan);

  // 8. Review & Individual Overrides
  await reviewAndEdit(plan);

  // Finalize
  plan.status = 'pending';
  plan.updatedAt = new Date().toISOString();
  await savePlan(plan);

  console.log(chalk.green(`\nPlan finalized and saved to ${lib.paths.plan(plan.discId)}`));
}

async function selectUnplannedDisc(): Promise<DiscMetadata | null> {
  const pending = unwrapOrExit(await lib.plans.pending(), 1);
  const metadata: DiscMetadata[] = [];

  for (const discId of pending) {
    const metaRes = await lib.storage.readMetadata(discId);

    // no-op to skip errors
    metaRes.match(meta => { metadata.push(meta); }, () => {});
  }

  const options = metadata.map(meta => ({
    name: `${meta.userProvidedName || meta.volumeLabel} (${meta.discId})`,
    value: meta
  })); 

  if (options.length === 0) {
    console.log(chalk.yellow("No unplanned metadata found. Run 'ink metadata read' first."));
    return null;
  }

  return await select({
    message: "Select a disc to plan:",
    choices: options 
  });
}

async function selectDurationCutoff(metadata: DiscMetadata, type: 'movie' | 'tv'): Promise<number> {
  const options = [5, 15, 45, 60, 90];
  const defaultOption = type === 'movie' ? 60 : 15;

  const choices = options.map(mins => {
    const included = metadata.tracks.filter(t => durationToMinutes(t.duration) >= mins).length;
    const excluded = metadata.tracks.length - included;
    return {
      name: `${mins}m (${included} tracks included, ${excluded} excluded)`,
      value: mins
    };
  });

  return await select({
    message: "Select duration cut-off:",
    choices,
    default: defaultOption
  });
}

async function selectTracks(metadata: DiscMetadata, cutoffMinutes: number): Promise<number[]> {
  const choices = metadata.tracks.map(t => {
    const mins = durationToMinutes(t.duration);
    return {
      name: `Track ${t.trackNumber}: ${t.duration} (${(t.size / 1024 / 1024).toFixed(0)} MB)`,
      value: t.trackNumber,
      checked: mins >= cutoffMinutes
    };
  });

  return await checkbox({
    message: "Select tracks to include:",
    choices
  });
}

function generateInitialTrackPlans(
  metadata: DiscMetadata, 
  indices: number[], 
  pattern: string, 
  offset: number, 
  destination: string,
  config: TrackConfiguration
): TrackPlan[] {
  return indices.map((idx, i) => {
    const track = metadata.tracks.find(t => t.trackNumber === idx)!;
    let filename = pattern;
    if (pattern.includes('XX')) {
      const num = (i + offset).toString().padStart(2, '0');
      filename = pattern.replace('XX', num);
    } else if (indices.length > 1) {
      // Fallback if multiple tracks but no XX
      filename = `${pattern}_${(i + offset).toString().padStart(2, '0')}`;
    }

    // Filter Audio
    const keepLanguages = new Set(['eng']);
    if (config.isForeign && config.originalLanguage) {
        keepLanguages.add(config.originalLanguage);
    }
    
    // We only filter if we have >1 track, otherwise keep what we have
    const audioToKeep = track.audio.length > 1 
        ? track.audio
            .filter(a => keepLanguages.has(a.language))
            .map(a => a.language) // We store language codes in the plan
        : track.audio.map(a => a.language);
    
    // Filter Subtitles
    const subsToKeep = track.subtitles
        .filter(s => config.keepSubtitles.includes(s.language))
        .map(s => s.language);

    return {
      trackNumber: idx as TrackNumber,
      name: filename,
      extract: true,
      transcode: {
          codec: 'libx265',
          preset: 'medium',
          crf: 18,
          audio: [...new Set(audioToKeep)], // Dedupe
          subtitles: [...new Set(subsToKeep)],
          isAnimated: config.isAnimated
      },
      output: {
        filename: filename,
        directory: destination
      }
    };
  });
}

interface TrackConfiguration {
    isForeign: boolean;
    originalLanguage?: string;
    keepSubtitles: string[];
    isAnimated: boolean;
}

async function configureTracks(metadata: DiscMetadata, indices: number[]): Promise<TrackConfiguration> {
    // 1. Content Type Analysis
    const isAnimated = await select({
        message: "Is this content animated (cartoons/anime)?",
        choices: [
            { name: "No (Live Action)", value: false },
            { name: "Yes (Animation)", value: true }
        ]
    });

    // 2. Audio Analysis
    // Check if any selected track has non-english audio
    const hasMultipleAudio = indices.some(idx => {
        const t = metadata.tracks.find(tr => tr.trackNumber === idx);
        return t && t.audio.length > 1;
    });

    let isForeign = false;
    let originalLanguage: string | undefined = undefined;

    if (hasMultipleAudio) {
        const answer = await select({
            message: "Is this a foreign film/show (non-English original audio)?",
            choices: [
                { name: "No (Keep English only)", value: false },
                { name: "Yes (Keep Original + English)", value: true }
            ]
        });
        isForeign = answer;

        if (isForeign) {
            // Find unique languages across all tracks
            const languages = new Set<string>();
            indices.forEach(idx => {
                const t = metadata.tracks.find(tr => tr.trackNumber === idx);
                t?.audio.forEach(a => languages.add(a.language));
            });
            languages.delete('eng');

            if (languages.size > 0) {
                originalLanguage = await select({
                    message: "Select the original language:",
                    choices: Array.from(languages).map(lang => ({ name: lang, value: lang }))
                });
            }
        }
    }

    // 2. Subtitle Analysis
    const allSubLanguages = new Set<string>();
    indices.forEach(idx => {
        const t = metadata.tracks.find(tr => tr.trackNumber === idx);
        t?.subtitles.forEach(s => allSubLanguages.add(s.language));
    });

    let keepSubtitles: string[] = [];
    if (allSubLanguages.size > 0) {
        keepSubtitles = await checkbox({
            message: "Select subtitle languages to keep:",
            choices: Array.from(allSubLanguages).map(lang => ({
                name: lang,
                value: lang,
                checked: lang === 'eng'
            }))
        });
    }

    return {
        isForeign,
        originalLanguage,
        keepSubtitles,
        isAnimated
    };
}

async function reviewAndEdit(plan: BackupPlan) {
  while (true) {
    console.log(chalk.bold("\nCurrent Plan Review:"));
    plan.tracks.forEach((t, i) => {
      console.log(`${i + 1}. Track ${t.trackNumber} -> ${t.output.filename}`);
    });

    const action = await select({
      message: "Does this look correct?",
      choices: [
        { name: "Yes, finalize plan", value: "finalize" },
        { name: "Override an individual name", value: "override" },
        { name: "Cancel", value: "cancel" }
      ]
    });

    if (action === "finalize") break;
    if (action === "cancel") process.exit(0);

    if (action === "override") {
      const toOverride = await select({
        message: "Select track to override:",
        choices: plan.tracks.map((t, i) => ({
          name: `Track ${t.trackNumber}: ${t.output.filename}`,
          value: i
        }))
      });

      const newName = await input({
        message: `New name for Track ${plan.tracks[toOverride].trackNumber}:`,
        default: plan.tracks[toOverride].name
      });

      plan.tracks[toOverride].name = newName;
      plan.tracks[toOverride].output.filename = newName;
      await savePlan(plan);
    }
  }
}

function durationToMinutes(duration: string): number {
  const parts = duration.split(':').map(Number);
  if (parts.length === 3) {
    return parts[0] * 60 + parts[1] + parts[2] / 60;
  }
  return 0;
}

interface ImdbResult {
    id: string;
    title: string;
    year: number;
    type?: string;
}

async function searchImdb(query: string): Promise<ImdbResult[]> {
    try {
        const q = query.trim();
        if (!q) return [];
        const firstChar = q.charAt(0).toLowerCase();
        // IMDB suggestion API requires the first character in the path
        if (!/[a-z0-9]/.test(firstChar)) return [];
        
        const url = `https://v2.sg.media-imdb.com/suggestion/${firstChar}/${encodeURIComponent(q)}.json`;
        
        const response = await fetch(url);
        if (!response.ok) return [];
        
        const data = await response.json() as any;
        if (!data.d) return [];
        
        return data.d.map((item: any) => ({
            id: item.id,
            title: item.l,
            year: item.y,
            type: item.q
        })).filter((item: ImdbResult) => item.title && item.year);
    } catch (e) {
        return [];
    }
}
