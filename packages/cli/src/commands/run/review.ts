import { Command } from "commander";
import * as fs from "fs/promises";
import * as path from "path";
import chalk from "chalk";
import { select, input, confirm } from "@inquirer/prompts";
import { spawn } from "child_process";
import Fuse from "fuse.js";
import { loadPlan, savePlan } from "../plan/utils";
import { 
    getTvMazeEpisodes,
    TvMazeEpisode
} from "../metadata/utils";
import { 
    getStagingDir, 
    getEncodedPath, 
    getEncodedStatusPath, 
    getReviewedStatusPath, 
    ensureDirs, 
    hasStatus, 
    writeStatus, 
    getExtractedStatusPath,
    getExtractedPath
} from "./utils";
import { BackupPlan, DiscId, lib } from "@ink/shared";

export const runReview = (parent: Command) => {
    parent
        .command('review')
        .argument('[discId]', 'Optional disc ID to review')
        .description('Interactively review and name encoded tracks')
        .action(run);
};

async function run(discIdArg?: string) {
    const stagingDir = getStagingDir();
    try {
        await fs.access(stagingDir);
    } catch {
        console.log("No staging directory found.");
        return;
    }

    const discDirs = await fs.readdir(stagingDir);
    let processedAny = false;

    for (const discIdStr of discDirs) {
        if (discIdStr.startsWith('.')) continue;
        if (discIdArg && discIdStr !== discIdArg) continue;
        const discId = discIdStr as DiscId;

        const plan = await loadPlan(discId);
        if (!plan || plan.type === 'movie') {
          continue;
        }

        // Ensure directories exist (especially 'reviewed')
        await ensureDirs(discId);

        // Find tracks that are encoded but not reviewed
        let needsReview = false;
        const tracksToReview = [];

        for (const track of plan.tracks) {
            if (track.extract) {
                const extractedStatus = lib.paths.discStaging.markers.extractedDone(discId, track.trackNumber);
                const reviewedStatus = lib.paths.discStaging.markers.reviewedDone(discId, track.trackNumber);
                const ignoredStatus = lib.paths.discStaging.markers.reviewedIgnored(discId, track.trackNumber);

                const isExtracted = await hasStatus(extractedStatus);
                const isReviewed = await hasStatus(reviewedStatus);
                const isIgnored = await hasStatus(ignoredStatus);

                if (isExtracted && !isReviewed && !isIgnored) {
                    needsReview = true;
                    tracksToReview.push(track);
                }
            }
        }

        if (!needsReview) {
            // Check if we need to finalize (all reviewed but plan status not 'approved')
            if (plan.status !== 'approved' && plan.status !== 'completed') {
                 const allDone = await checkAllReviewed(plan, discId);
                 if (allDone) {
                     processedAny = true;
                     await finalizePlan(plan, discId);
                 }
            }
            continue;
        }

        processedAny = true;
        console.log(chalk.bold(`\nReviewing Plan: ${plan.title} (${discId})`));

        if (plan.candidates && plan.candidates.length > 0) {
            await reviewCompilation(plan, discId, tracksToReview);
        } else if (plan.tvShow) {
            await reviewStandardSeason(plan, discId, tracksToReview);
        } else {
            console.log(chalk.yellow("Plan type not supported for automated review."));
        }
    }

    if (!processedAny) {
        console.log("No plans pending review.");
    }
}

async function reviewStandardSeason(plan: BackupPlan, discId: DiscId, tracksToReview: any[]) {
    if (!plan.tvShow) return;

    console.log(chalk.blue(`Calculating episode offsets for ${plan.tvShow.name} Season ${plan.tvShow.season}...`));

    // 1. Load all plans to find offsets
    const listRes = await lib.storage.listAllPlanFiles();
    if (listRes.isErr()) {
        console.error(chalk.red(`Error listing plans: ${listRes.error.message}`));
        return;
    }
    const allIds = listRes.value;
    const relatedPlans: BackupPlan[] = [];

    for (const id of allIds) {
        if (id === discId) continue;
        const planRes = await lib.storage.readPlan(id);
        if (planRes.isOk()) {
            const p = planRes.value;
            if (p.tvShow && p.tvShow.imdbId === plan.tvShow.imdbId && p.tvShow.season === plan.tvShow.season) {
                relatedPlans.push(p);
            }
        }
    }

    // Sort by disc number
    relatedPlans.sort((a, b) => (a.tvShow?.disc || 0) - (b.tvShow?.disc || 0));

    let episodeOffset = 0;
    let missingDiscs = false;

    for (let i = 1; i < plan.tvShow.disc; i++) {
        const prevDisc = relatedPlans.find(p => p.tvShow?.disc === i);
        if (prevDisc) {
            let foundMaxInDisc = 0;
            let hasParsedNames = false;

            for (const t of prevDisc.tracks) {
                if (!t.extract) continue;
                // Match S01E05 or S1E5 in the finalized name
                const match = t.name.match(/S\d+E(\d+)/);
                if (match) {
                    const n = parseInt(match[1]);
                    if (n > foundMaxInDisc) foundMaxInDisc = n;
                    hasParsedNames = true;
                }
            }

            if (hasParsedNames) {
                // If we found definitive episode numbers, use the max as our new baseline
                if (foundMaxInDisc > episodeOffset) {
                    episodeOffset = foundMaxInDisc;
                }
            } else {
                // Fallback: Just count extracted tracks if no definitive names found
                episodeOffset += prevDisc.tracks.filter(t => t.extract).length;
            }
        } else {
            missingDiscs = true;
            break;
        }
    }

    if (missingDiscs) {
        console.log(chalk.yellow(`Warning: I couldn't find plans for all discs prior to Disc ${plan.tvShow.disc}.`));
        const startEpStr = await input({
            message: `What is the starting episode number for Disc ${plan.tvShow.disc}?`,
            default: (episodeOffset + 1).toString()
        });
        episodeOffset = (parseInt(startEpStr) || 1) - 1;
    }

    console.log(chalk.gray(`Start Episode: ${episodeOffset + 1}`));

    // 2. Fetch episode names from TVMaze
    const allEpisodes = await getTvMazeEpisodes(plan.tvShow.tvMazeId || 0);
    const seasonEpisodes = allEpisodes.filter(e => e.season === plan.tvShow!.season);

    // 3. Prepare for review
    const allExtractedTracks = plan.tracks.filter(t => t.extract).sort((a, b) => (a.trackNumber as number) - (b.trackNumber as number));
    
    // Pre-load assigned episodes to sync the counter and assigned set
    const assignedEpisodeIds = new Set<number>();
    
    // First pass: Load existing state
    const trackStates = new Map<number, { isExtracted: boolean, isReviewed: boolean, isIgnored: boolean, episodeId?: number }>();
    for (const t of allExtractedTracks) {
        const ePath = lib.paths.discStaging.markers.extractedDone(discId, t.trackNumber);
        const rPath = lib.paths.discStaging.markers.reviewedDone(discId, t.trackNumber);
        const iPath = lib.paths.discStaging.markers.reviewedIgnored(discId, t.trackNumber);
        
        let state = { isExtracted: false, isReviewed: false, isIgnored: false, episodeId: undefined };
        state.isExtracted = await hasStatus(ePath);

        if (await hasStatus(rPath)) {
            try {
                const data = JSON.parse(await fs.readFile(rPath, 'utf-8'));
                if (data.episodeId) {
                    assignedEpisodeIds.add(data.episodeId);
                    state.isReviewed = true;
                    state.episodeId = data.episodeId;
                }
            } catch {}
        } else if (await hasStatus(iPath)) {
            state.isIgnored = true;
        }
        trackStates.set(t.trackNumber, state);
    }

    console.log(chalk.blue("\nStarting interactive review..."));

    let currentVlc: ReturnType<typeof playVideo> | null = null;
    let nextExpectedEpisodeNumber = episodeOffset + 1;

    for (const track of allExtractedTracks) {
        const state = trackStates.get(track.trackNumber)!;

        // If already processed, just update our counter and move on
        if (state.isReviewed && state.episodeId) {
            const ep = seasonEpisodes.find(e => e.id === state.episodeId);
            if (ep) {
                console.log(chalk.green(`Track ${track.trackNumber} [Reviewed]: ${ep.name} (S${ep.season}E${ep.number})`));
                nextExpectedEpisodeNumber = ep.number + 1;
            }
            continue;
        }

        if (state.isIgnored) {
            console.log(chalk.gray(`Track ${track.trackNumber} [Ignored]`));
            // Do NOT increment nextExpectedEpisodeNumber
            continue;
        }

        if (!state.isExtracted) {
            // We can't safely review this or any subsequent tracks yet because it would
            // throw off the episode counter for this disc.
            break;
        }

        // --- Interactive Review for Pending Track ---

        const filePath = getExtractedPath(discId, track.trackNumber);
        console.log(chalk.cyan(`\n--- Track ${track.trackNumber} ---`));
        
        // Kill previous VLC
        if (currentVlc) { try { currentVlc.kill(); } catch {} }

        // Open VLC
        currentVlc = playVideo(filePath);
        console.log(chalk.gray(`Playing ${filePath}...`));

        // Propose dynamic episode
        let match = seasonEpisodes.find(e => e.number === nextExpectedEpisodeNumber);
        let choice: "yes" | "no" | "ignore" | "skip" | "quit" | undefined;

        if (match) {
            choice = await select({
                message: `Is this S${match.season}E${match.number} - ${match.name}?`,
                choices: [
                    { name: "Yes", value: "yes" },
                    { name: "No (Select another)", value: "no" },
                    { name: chalk.red("Ignore track (junk/duplicate)"), value: "ignore" },
                    { name: "Skip for now", value: "skip" },
                    { name: "Quit Review", value: "quit" }
                ]
            }) as any;
        } else {
             console.log(chalk.yellow(`No proposed episode found for #${nextExpectedEpisodeNumber} (end of season?).`));
             choice = await select({
                 message: `Action for Track ${track.trackNumber}:`,
                 choices: [
                    { name: "Select episode manually", value: "no" },
                    { name: chalk.red("Ignore track (junk/duplicate)"), value: "ignore" },
                    { name: "Skip for now", value: "skip" },
                    { name: "Quit Review", value: "quit" }
                 ]
             }) as any;
        }

        if (choice === "quit") break;
        
        if (choice === "skip") {
            // Do NOT increment counter
            continue;
        }
        
        if (choice === "ignore") {
            await writeStatus(lib.paths.discStaging.markers.reviewedIgnored(discId, track.trackNumber), {
                discId,
                trackNumber: track.trackNumber,
                timestamp: new Date().toISOString(),
                ignored: true
            });
            console.log(chalk.gray(`Track ${track.trackNumber} ignored.`));
            // Do NOT increment counter
            continue;
        }

        if (choice === "no") {
             // Selection logic
             const availableEpisodes = seasonEpisodes.filter(e => !assignedEpisodeIds.has(e.id));
             
             const choices = availableEpisodes.map(e => ({
                 name: `S${e.season}E${e.number} - ${e.name}`,
                 value: e.id
             }));
             
             choices.push({ name: "Skip", value: -1 });
             choices.push({ name: chalk.red("Ignore track"), value: -2 });
             choices.push({ name: "Quit", value: -3 });

             const selectedId = await select({
                 message: "Select the correct episode:",
                 choices: choices
             });

             if (selectedId === -3) break;
             if (selectedId === -1) continue; // Skip
             if (selectedId === -2) { // Ignore
                await writeStatus(lib.paths.discStaging.markers.reviewedIgnored(discId, track.trackNumber), {
                    discId,
                    trackNumber: track.trackNumber,
                    timestamp: new Date().toISOString(),
                    ignored: true
                });
                console.log(chalk.gray(`Track ${track.trackNumber} ignored.`));
                continue;
             }

             match = seasonEpisodes.find(e => e.id === selectedId);
        }

        if (match) {
            const newName = `${plan.title} - S${plan.tvShow.season.toString().padStart(2, '0')}E${match.number.toString().padStart(2, '0')} - ${match.name}`;
            
            await writeStatus(lib.paths.discStaging.markers.reviewedDone(discId, track.trackNumber), {
                discId,
                trackNumber: track.trackNumber,
                timestamp: new Date().toISOString(),
                finalName: newName,
                episodeId: match.id
            });
            
            assignedEpisodeIds.add(match.id);
            // Update counter to follow this assignment
            nextExpectedEpisodeNumber = match.number + 1;
            console.log(chalk.green(`MARKED: ${newName}`));
        }
    }

    if (currentVlc) { try { currentVlc.kill(); } catch {} }

    // Check if we finished everything just now
    const allDone = await checkAllReviewed(plan, discId);
    if (allDone) {
        await finalizePlan(plan, discId);
    }
}

async function checkAllReviewed(plan: BackupPlan, discId: string): Promise<boolean> {
    for (const track of plan.tracks) {
        if (track.extract) {
            const reviewedStatus = lib.paths.discStaging.markers.reviewedDone(discId, track.trackNumber);
            const ignoredStatus = lib.paths.discStaging.markers.reviewedIgnored(discId, track.trackNumber);
            if (!(await hasStatus(reviewedStatus)) && !(await hasStatus(ignoredStatus))) return false;
        }
    }
    return true;
}

async function finalizePlan(plan: BackupPlan, discId: string) {
    console.log(chalk.green(`\nFinalizing plan for ${plan.title}...`));
    
    // Read all reviewed status files and update plan
    for (const track of plan.tracks) {
        if (track.extract) {
            const reviewedPath = lib.paths.discStaging.markers.reviewedDone(discId, track.trackNumber);
            const ignoredPath = lib.paths.discStaging.markers.reviewedIgnored(discId, track.trackNumber);
            
            if (await hasStatus(reviewedPath)) {
                try {
                    const content = await fs.readFile(reviewedPath, 'utf-8');
                    const data = JSON.parse(content);
                    
                    if (data.finalName) {
                        track.name = data.finalName;
                        track.output.filename = data.finalName;
                    }
                } catch (e) {
                    console.error(chalk.red(`Error reading reviewed status for Track ${track.trackNumber}: ${e}`));
                    return;
                }
            } else if (await hasStatus(ignoredPath)) {
                // Track is ignored, so we don't need to update the plan with a final name
                // It will be skipped during copy phase
                console.log(chalk.gray(`Track ${track.trackNumber} is ignored.`));
            } else {
                 console.error(chalk.red(`Error: Track ${track.trackNumber} has no review status (neither done nor ignored).`));
                 return;
            }
        }
    }

    plan.status = 'approved';
    await savePlan(plan);
    console.log(chalk.green("Plan updated and approved. Ready for copy."));
}


import { ChildProcess } from "child_process";

async function reviewCompilation(plan: BackupPlan, discId: string, tracksToReview: any[]) {
    console.log(chalk.blue("Starting visual verification for compilation disc..."));
    
    // Sort tracks by track number
    const tracks = tracksToReview.sort((a, b) => a.trackNumber - b.trackNumber);
    
    let currentVlc: ChildProcess | null = null;

    for (const track of tracks) {
        const filePath = getExtractedPath(discId, track.trackNumber);

        console.log(chalk.cyan(`\nPlaying Track ${track.trackNumber} (${filePath})...`));
        
        // Kill previous VLC if running
        if (currentVlc) {
            try {
                currentVlc.kill();
            } catch {}
        }

        // Launch VLC in background
        currentVlc = playVideo(filePath);

        // Get already assigned candidates to filter list
        const assignedIds = new Set<number>();
        for (const t of plan.tracks) {
             const rPath = getReviewedStatusPath(discId, t.trackNumber);
             if (await hasStatus(rPath)) {
                 const data = JSON.parse(await fs.readFile(rPath, 'utf-8'));
                 if (data.episodeId) assignedIds.add(data.episodeId);
             }
        }

        const choices = (plan.candidates || [])
            .filter(c => !assignedIds.has(c.id))
            .map(c => ({
                name: `${c.name} (S${c.season}E${c.number})`,
                value: c.id
            }));
        
        choices.push({ name: chalk.blue("Search TVMaze for episode..."), value: -2 });
        choices.push({ name: "Skip / Leave Unnamed", value: -1 });

        let selectedId = -1;
        let selectedEpisode: any = null;

        while (true) {
            selectedId = await select({
                message: `Identify Track ${track.trackNumber}:`,
                choices: choices
            });

            if (selectedId === -2) {
                // Search TVMaze
                const query = await input({ message: "Search episode name:" });
                if (query.trim() && plan.tvShow?.tvMazeId) {
                    const allEpisodes = await getTvMazeEpisodes(plan.tvShow.tvMazeId);
                    const fuse = new Fuse(allEpisodes, { keys: ['name'], threshold: 0.4 });
                    const searchResults = fuse.search(query);
                    
                    if (searchResults.length > 0) {
                        const searchChoices = searchResults.slice(0, 10).map(r => ({
                            name: `${r.item.name} (S${r.item.season}E${r.item.number})`,
                            value: r.item
                        }));
                        searchChoices.push({ name: "Back to candidates", value: null as any });

                        const picked = await select({
                            message: "Select matching episode:",
                            choices: searchChoices
                        });

                        if (picked) {
                            selectedEpisode = picked;
                            break;
                        }
                    } else {
                        console.log(chalk.yellow("No episodes found matching that search."));
                    }
                }
            } else {
                if (selectedId !== -1) {
                    selectedEpisode = (plan.candidates || []).find(c => c.id === selectedId);
                }
                break;
            }
        }

        if (selectedEpisode) {
            const match = selectedEpisode;
            const newName = `${plan.title} - S${match.season.toString().padStart(2, '0')}E${match.number.toString().padStart(2, '0')} - ${match.name}`;
            
            await writeStatus(getReviewedStatusPath(discId, track.trackNumber), {
                discId,
                trackNumber: track.trackNumber,
                timestamp: new Date().toISOString(),
                finalName: newName,
                episodeId: match.id
            });
            
            console.log(chalk.green(`  -> Marked as: ${newName}`));
        } else {
             console.log(chalk.yellow("Skipped."));
        }
    }
    
    // Cleanup final VLC
    if (currentVlc) {
        try {
            currentVlc.kill();
        } catch {}
    }
    
    // Check if we finished everything just now
    const allReviewed = await checkAllReviewed(plan, discId);
    if (allReviewed) {
        await finalizePlan(plan, discId);
    }
}

function playVideo(filePath: string): ChildProcess {
    const vlc = spawn('vlc', [filePath], { stdio: 'ignore', detached: true });
    vlc.on('error', () => {
        console.log(chalk.red("Failed to launch VLC. Is it installed?"));
    });
    return vlc;
}
