import { Command } from "commander";
import * as fs from "fs/promises";
import * as path from "path";
import chalk from "chalk";
import { BackupPlan } from "@ink/shared";
import { getPlansDir } from "./utils";
import { getTrackStatus } from "../run/utils";

export const planList = (parent: Command) => {
  parent
    .command('list')
    .description('List all backup plans')
    .option('--status <status>', 'Filter by status (draft, pending, in_progress, completed)')
    .option('--type <type>', 'Filter by type (movie, tv)')
    .option('--order <field>', 'Sort order (title, updated, status)', 'updated')
    .action(run);
}

async function run(options: { status?: string, type?: string, order: string }) {
    const dir = getPlansDir();
    try {
        await fs.access(dir);
    } catch {
        console.log("No plans found.");
        return;
    }

    const files = await fs.readdir(dir);
    const jsonFiles = files.filter(f => f.endsWith('.json'));
    
    if (jsonFiles.length === 0) {
        console.log("No plans found.");
        return;
    }

    const plans: { plan: BackupPlan, status: string }[] = [];
    
    // Read all files and calculate status
    for (const file of jsonFiles) {
        try {
            const content = await fs.readFile(path.join(dir, file), 'utf-8');
            const plan = JSON.parse(content) as BackupPlan;
            
            let status: string = plan.status;
            // Calculate dynamic status if not draft
            if (status !== 'draft') {
                let allCompleted = true;
                let anyStarted = false;
                
                for (const t of plan.tracks) {
                    const ts = await getTrackStatus(plan.discId, t.trackNumber);
                    if (ts !== 'completed') allCompleted = false;
                    if (ts !== 'pending') anyStarted = true;
                }

                if (allCompleted && plan.tracks.length > 0) status = 'completed';
                else if (anyStarted) status = 'in_progress';
                else status = 'pending';
            }

            plans.push({ plan, status });
        } catch (e) {
            // Ignore malformed files
        }
    }

    // Filter
    let filtered = plans;
    if (options.status) {
        filtered = filtered.filter(p => p.status.toLowerCase() === options.status!.toLowerCase());
    }
    if (options.type) {
        filtered = filtered.filter(p => p.plan.type.toLowerCase() === options.type!.toLowerCase());
    }

    if (filtered.length === 0) {
        console.log("No matching plans found.");
        return;
    }

    // Sort
    filtered.sort((a, b) => {
        if (options.order === 'title') {
            return a.plan.title.localeCompare(b.plan.title);
        } else if (options.order === 'status') {
            const statusDiff = a.status.localeCompare(b.status);
            if (statusDiff !== 0) return statusDiff;
            return a.plan.title.localeCompare(b.plan.title);
        } else {
            // Default to updated (newest first)
            return new Date(b.plan.updatedAt).getTime() - new Date(a.plan.updatedAt).getTime();
        }
    });
    
    // Header
    console.log(
        chalk.gray("STATUS".padEnd(12)) + 
        chalk.gray("TYPE".padEnd(8)) + 
        chalk.gray("TRACKS".padEnd(8)) + 
        chalk.gray("TITLE")
    );

    // Display
    for (const item of filtered) {
        const { plan, status } = item;
        let statusColor = chalk.gray;
        if (status === 'completed') statusColor = chalk.green;
        else if (status === 'in_progress') statusColor = chalk.cyan;
        else if (status === 'pending') statusColor = chalk.yellow;
        else if (status === 'draft') statusColor = chalk.blue;

        const type = plan.type === 'movie' ? 'Movie' : 'TV';
        const tracks = plan.tracks.length.toString();

        console.log(
            statusColor(status.padEnd(12)) + 
            chalk.white(type.padEnd(8)) + 
            chalk.white(tracks.padEnd(8)) + 
            chalk.bold.white(plan.title) + " " +
            chalk.gray(`(${plan.discId})`)
        );
    }
}
