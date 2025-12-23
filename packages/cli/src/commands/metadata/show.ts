import { Command } from "commander";
import * as fs from "fs/promises";
import chalk from "chalk";
import { DiscMetadata } from "@ink/shared";
import { getMetadataPath, displayMetadata } from "./utils";

export const metadataShow = (parent: Command) => {
  parent
    .command('show <disc-id>')
    .description('Show detailed metadata for a specific disc')
    .action(async (discId: string) => {
        const filepath = getMetadataPath(discId);
        
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
