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
        .description('Interactively review and name encoded tracks')
        .action(run);
};

async function run() {
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
                const extractedStatus = getExtractedStatusPath(discId, track.trackNumber);
                const reviewedStatus = getReviewedStatusPath(discId, track.trackNumber);

                if ((await hasStatus(extractedStatus)) && !(await hasStatus(reviewedStatus))) {
                    needsReview = true;
                    tracksToReview.push(track);
                }
            }
        }

        if (!needsReview) {
            // Check if we need to finalize (all reviewed but plan status not 'approved')
            if (plan.status !== 'approved' && plan.status !== 'completed') {
                 const allReviewed = await checkAllReviewed(plan, discId);
                 if (allReviewed) {
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
            episodeOffset += prevDisc.tracks.filter(t => t.extract).length;
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

    // 3. Propose Mapping
    const tracks = tracksToReview.sort((a, b) => (a.trackNumber as number) - (b.trackNumber as number));
    const mapping = tracks.map((t, i) => {
        const epNum = episodeOffset + i + 1;
        const epInfo = seasonEpisodes.find(e => e.number === epNum);
        const name = epInfo ? epInfo.name : "Unknown Episode";
        return {
            track: t,
            episodeNumber: epNum,
            episodeName: name
        };
    });

    console.log(chalk.bold("\nProposed Mapping:"));
    mapping.forEach(m => {
        console.log(`  Track ${m.track.trackNumber} -> S${plan.tvShow!.season.toString().padStart(2, '0')}E${m.episodeNumber.toString().padStart(2, '0')} - ${m.episodeName}`);
    });

    const confirmMapping = await confirm({ message: "Does this mapping look correct?", default: true });

    if (confirmMapping) {
        // Option to spot check
        const spotCheck = await confirm({ message: "Would you like to spot check the first track?", default: false });
        if (spotCheck) {
            const vlc = playVideo(getExtractedPath(discId, tracks[0].trackNumber));
            await select({ message: "Press enter when done watching...", choices: [{ name: "Done", value: true }] });
            vlc.kill();
        }

        // Write all statuses
        for (const m of mapping) {
            const newName = `${plan.title} - S${plan.tvShow.season.toString().padStart(2, '0')}E${m.episodeNumber.toString().padStart(2, '0')} - ${m.episodeName}`;
            await writeStatus(getReviewedStatusPath(discId, m.track.trackNumber), {
                discId,
                trackNumber: m.track.trackNumber,
                timestamp: new Date().toISOString(),
                finalName: newName,
                // We don't have a single episode ID here if we didn't search specifically, but we could find it
                episodeId: seasonEpisodes.find(e => e.number === m.episodeNumber)?.id
            });
        }
        console.log(chalk.green("All tracks marked as reviewed."));
    } else {
        console.log(chalk.yellow("Review cancelled. You may need to manually name these tracks or check previous disc plans."));
    }

    // Check if we finished everything just now
    const allReviewed = await checkAllReviewed(plan, discId);
    if (allReviewed) {
        await finalizePlan(plan, discId);
    }
}
async function checkAllReviewed(plan: BackupPlan, discId: string): Promise<boolean> {
    for (const track of plan.tracks) {
        if (track.extract) {
            const reviewedStatus = getReviewedStatusPath(discId, track.trackNumber);
            if (!(await hasStatus(reviewedStatus))) return false;
        }
    }
    return true;
}

async function finalizePlan(plan: BackupPlan, discId: string) {
    console.log(chalk.green(`\nFinalizing plan for ${plan.title}...`));
    
    // Read all reviewed status files and update plan
    for (const track of plan.tracks) {
        if (track.extract) {
            const reviewedPath = getReviewedStatusPath(discId, track.trackNumber);
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
