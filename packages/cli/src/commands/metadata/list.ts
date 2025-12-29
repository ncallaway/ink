import { Command } from "commander";
import * as fs from "fs/promises";
import * as path from "path";
import chalk from "chalk";
import { lib, DiscMetadata } from "@ink/shared";
import { loadPlan } from "../plan/utils";

interface MetadataItem {
  meta: DiscMetadata;
  title: string;
  status: string;
}

export const metadataList = (parent: Command) => {
  parent
    .command('list')
    .description('List all collected metadata')
    .option('--status <status>', 'Filter by status (e.g. unplanned, draft, pending)')
    .option('--order <field>', 'Sort order (label, status)', 'label')
    .action(async (options: { status?: string, order: string }) => {
        const dir = lib.paths.metadatas();
        try {
            await fs.access(dir);
        } catch {
            console.log("No metadata found.");
            return;
        }

        const files = await fs.readdir(dir);
        const jsonFiles = files.filter(f => f.endsWith('.json'));
        
        if (jsonFiles.length === 0) {
            console.log("No metadata found.");
            return;
        }

        const items: MetadataItem[] = [];
        
        // Read all files
        for (const file of jsonFiles) {
            try {
                const content = await fs.readFile(path.join(dir, file), 'utf-8');
                const meta = JSON.parse(content) as DiscMetadata;
                const title = meta.userProvidedName || meta.volumeLabel || "Unknown";
                
                const plan = await loadPlan(meta.discId);
                const status = plan ? plan.status : "unplanned";

                items.push({ meta, title, status });
            } catch (e) {
                // Ignore malformed files
            }
        }

        // Filter
        const filtered = options.status 
            ? items.filter(i => i.status.toLowerCase() === options.status!.toLowerCase())
            : items;

        if (filtered.length === 0) {
            console.log("No matching metadata found.");
            return;
        }

        // Sort
        filtered.sort((a, b) => {
            if (options.order === 'status') {
                const statusDiff = a.status.localeCompare(b.status);
                if (statusDiff !== 0) return statusDiff;
                return a.title.localeCompare(b.title);
            }
            // Default to label/title
            return a.title.localeCompare(b.title);
        });
        
        // Display
        for (const item of filtered) {
            let statusColor = chalk.gray;
            if (item.status === 'completed') statusColor = chalk.green;
            else if (item.status === 'pending') statusColor = chalk.yellow;
            else if (item.status === 'draft') statusColor = chalk.blue;

             // Format: Title (bold/white) ID (dimmed) Status
            console.log(
                chalk.bold.white(item.title) + " " + 
                chalk.gray(item.meta.discId) + " " + 
                statusColor(item.status)
            );
        }
    });
}
