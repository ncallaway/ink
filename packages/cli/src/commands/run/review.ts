import { Command } from "commander";
import * as fs from "fs/promises";
import * as path from "path";
import chalk from "chalk";
import { select, input } from "@inquirer/prompts";
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
import { BackupPlan } from "@ink/shared";

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

    for (const discId of discDirs) {
        if (discId.startsWith('.')) continue;

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
        } else {
            // TODO: Standard Season Review Logic
            console.log(chalk.yellow("Standard season review logic not yet implemented."));
        }
    }

    if (!processedAny) {
        console.log("No plans pending review.");
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
