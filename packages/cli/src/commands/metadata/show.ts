import { Command } from "commander";
import * as fs from "fs/promises";
import chalk from "chalk";
import { lib, DiscMetadata, DiscId } from "@ink/shared";
import { displayMetadata } from "./utils";

export const metadataShow = (parent: Command) => {
  parent
    .command('show <disc-id>')
    .description('Show detailed metadata for a specific disc')
    .action(async (discId: DiscId) => {
        const filepath = lib.paths.metadata(discId);
        
        try {
            const content = await fs.readFile(filepath, 'utf-8');
            const meta = JSON.parse(content) as DiscMetadata;
            displayMetadata(meta);
        } catch (e: any) {
            if (e.code === 'ENOENT') {
                console.error(chalk.red(`Metadata for disc ID '${discId}' not found.`));
            } else {
                console.error(chalk.red(`Error reading metadata: ${e.message}`));
            }
            process.exitCode = 1;
        }
    });
}
