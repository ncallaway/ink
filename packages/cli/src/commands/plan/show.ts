import { Command } from "commander";
import chalk from "chalk";
import { loadPlan, displayPlan } from "./utils";

export const planShow = (parent: Command) => {
  parent
    .command('show <disc-id>')
    .description('Show details of a specific plan')
    .action(async (discId: string) => {
        const plan = await loadPlan(discId);
        
        if (!plan) {
            console.error(chalk.red(`Plan for disc ID '${discId}' not found.`));
            process.exitCode = 1;
            return;
        }

        await displayPlan(plan);
    });
}
