import { Command } from "commander";
import * as fs from "fs/promises";
import chalk from "chalk";
import { DiscId, lib } from "@ink/shared";

export const metadataDelete = (parent: Command) => {
  parent
    .command('delete <disc-id>')
    .description('Delete metadata for a specific disc')
    .action(async (discId: DiscId) => {
        const filepath = lib.paths.metadata(discId);
        
        try {
            await fs.unlink(filepath);
            console.log(chalk.green(`Metadata for '${discId}' deleted.`));
        } catch (e: any) {
            if (e.code === 'ENOENT') {
                console.error(chalk.red(`Metadata for disc ID '${discId}' not found.`));
            } else {
                console.error(chalk.red(`Error deleting metadata: ${e.message}`));
            }
            process.exitCode = 1;
        }
    });
}
