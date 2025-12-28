import { Command } from "commander";
import * as fs from "fs/promises";
import * as path from "path";
import chalk from "chalk";
import { select, input, checkbox, confirm } from "@inquirer/prompts";
import { DiscMetadata, BackupPlan, TrackMetadata, TrackPlan, lib } from "@ink/shared";
import { getMetadataDir, loadMetadata } from "../metadata/utils";
import { getPlansDir, getPlanPath, savePlan, loadPlan } from "./utils";

export const planCreate = (parent: Command) => {
  parent
    .command('create [disc-id]')
    .description('Create a new backup plan')
    .action(run);
}

async function run(discId?: string) {
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

  // 2. Identify Title & Year
  let title = await input({
    message: "Enter the title:",
    default: plan.title
  });

  let year = "";

  console.log(chalk.blue("Searching metadata..."));
  const results = await searchImdb(title);
  
  if (results.length > 0) {
    const choices = results.map(r => ({
      name: `${r.title} (${r.year}) [${r.type}]`,
      value: r
    }));
    choices.push({ name: "Enter manually...", value: null as any }); // Cast to any to allow null

    const selected = await select({
      message: "Select the correct match:",
      choices: choices
    });

    if (selected) {
      title = selected.title;
      year = selected.year.toString();
      plan.imdbId = selected.id;
    }
  }

  if (!year) {
    year = await input({
      message: "Enter the release year (YYYY):",
      validate: (val) => /^\d{4}$/.test(val) ? true : "Please enter a valid 4-digit year."
    });
  }

  plan.title = title;
  await savePlan(plan);

  // 3. Duration Cut-off
  const cutoffMinutes = await selectDurationCutoff(metadata, plan.type);
  
  // 4. Destination Path
  let destination = "";
  if (plan.type === 'movie') {
    destination = 'movies/';
  } else {
    const defaultDest = path.join('tv', plan.title.replace(/[^a-z0-9]/gi, '_'));
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

  // 6. Naming Convention & Offset
  let pattern = "";
  let offset = 0;

  if (plan.type === 'movie') {
    // For movies, automatically use "Title (Year)"
    // If multiple tracks are selected, the generator will append _00, _01, etc.
    pattern = `${title} (${year})`;
  } else {
    // TV Show Logic
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
  plan.tracks = generateInitialTrackPlans(metadata, selectedTrackIndices, pattern, offset, destination);
  await savePlan(plan);

  // 6. Review & Individual Overrides
  await reviewAndEdit(plan);

  // Finalize
  plan.status = 'pending';
  plan.updatedAt = new Date().toISOString();
  await savePlan(plan);

  console.log(chalk.green(`\nPlan finalized and saved to ${getPlanPath(plan.discId)}`));
}

async function selectUnplannedDisc(): Promise<DiscMetadata | null> {
  const metaDir = getMetadataDir();
  const planDir = getPlansDir();

  try {
    await fs.mkdir(planDir, { recursive: true });
    const metaFiles = (await fs.readdir(metaDir)).filter(f => f.endsWith('.json'));
    
    const unplanned: { name: string, value: DiscMetadata }[] = [];

    for (const file of metaFiles) {
      const discId = file.replace('.json', '');
      const planExists = await fs.access(getPlanPath(discId)).then(() => true).catch(() => false);
      
      if (!planExists) {
        const meta = await loadMetadata(discId);
        if (meta) {
          unplanned.push({
            name: `${meta.userProvidedName || meta.volumeLabel} (${discId})`,
            value: meta
          });
        }
      }
    }

    if (unplanned.length === 0) {
      console.log(chalk.yellow("No unplanned metadata found. Run 'ink metadata read' first."));
      return null;
    }

    return await select({
      message: "Select a disc to plan:",
      choices: unplanned
    });
  } catch (e: any) {
    console.error(chalk.red(`Error listing metadata: ${e.message}`));
    return null;
  }
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
  destination: string
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

    return {
      trackNumber: idx,
      name: filename,
      extract: true,
      output: {
        filename: filename,
        directory: destination
      }
    };
  });
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
            type: item.q // 'feature', 'TV series', etc.
        })).filter((item: ImdbResult) => item.title && item.year);
    } catch (e) {
        return []; // Fail silently
    }
}
