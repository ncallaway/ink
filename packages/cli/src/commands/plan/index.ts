import { Command } from "commander";
import { planCreate } from "./create";
import { planList } from "./list";
import { planShow } from "./show";
import { planDelete } from "./delete";
import { planPending } from "./pending";

export const defineCommand = (parent: Command) => {
  const plan = parent.command('plan').description('Manage backup plans');

  planPending(plan);
  planCreate(plan);
  planList(plan);
  planShow(plan);
  planDelete(plan);

  plan
    .command('import <plan-file>')

  plan
    .command('validate <plan-file>')
    .description('Validate a plan file')
    .action((planFile) => {
      console.log(`TODO: Validate plan file ${planFile}`);
    });
}
