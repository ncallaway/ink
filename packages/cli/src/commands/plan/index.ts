import { Command } from "commander";
import { planCreate } from "./create";

export const defineCommand = (parent: Command) => {
  const plan = parent.command('plan').description('Manage backup plans');

  planCreate(plan);

  plan
    .command('list')
    .description('List all backup plans')
    .action(() => {
      console.log('TODO: Implement plan list');
    });

  plan
    .command('show <disc-id>')
    .description('Show details of a specific plan')
    .action((discId) => {
      console.log(`TODO: Show plan for ${discId}`);
    });

  plan
    .command('import <plan-file>')
    .description('Import a plan from a JSON file')
    .action((planFile) => {
      console.log(`TODO: Import plan from ${planFile}`);
    });

  plan
    .command('export <disc-id>')
    .description('Export metadata as a plan template')
    .action((discId) => {
      console.log(`TODO: Export plan template for ${discId}`);
    });

  plan
    .command('delete <disc-id>')
    .description('Delete a backup plan')
    .action((discId) => {
      console.log(`TODO: Delete plan for ${discId}`);
    });

  plan
    .command('validate <plan-file>')
    .description('Validate a plan file')
    .action((planFile) => {
      console.log(`TODO: Validate plan file ${planFile}`);
    });
}