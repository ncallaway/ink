import { Command } from "commander";
import * as fs from "fs/promises";
import chalk from "chalk";
import { DiscId, lib } from "@ink/shared";

export const planDelete = (parent: Command) => {
  parent
    .command('delete <disc-id>')
    .description('Delete a backup plan')
    .action(async (discId: DiscId) => {
        const filepath = lib.paths.plan(discId);
        
        try {
            await fs.unlink(filepath);
            console.log(chalk.green(`Plan for '${discId}' deleted.`));
        } catch (e: any) {
            if (e.code === 'ENOENT') {
                console.error(chalk.red(`Plan for disc ID '${discId}' not found.`));
            } else {
                console.error(chalk.red(`Error deleting plan: ${e.message}`));
            }
            process.exitCode = 1;
        }
    });
}
