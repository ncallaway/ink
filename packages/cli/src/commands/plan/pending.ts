import { Command } from "commander";
import chalk from "chalk";
import Table from "cli-table3";
import { lib } from "@ink/shared";
import { unwrapOrExit } from "../../utils/unwrap";

export const planPending = (parent: Command) => {
  parent
    .command('pending')
    .description('Show all imported metadata that don\'t yet have a plan.')
    .action(run);
}

async function run() {
  const pending = unwrapOrExit(await lib.plans.pending(), 1);

  if (pending.length === 0) {
    console.log("No imported metadata needs a plan.");
    process.exit(0);
  }

  const pendingTable = new Table({
    head: ['Disc ID', 'Disc Name', 'Tracks'],
    style: { head: [] },
  });

  for (const discId of pending) {
    const metaRes = await lib.storage.readMetadata(discId);
    metaRes.match(meta => {
      const title = meta.userProvidedName || meta.volumeLabel || "Unknown";
      const trackCount = meta.tracks.length;
      pendingTable.push([chalk.gray(discId), title, trackCount]);
    }, err => {
      pendingTable.push([chalk.red(discId), { colSpan: 2, content: err.message }]);
    });
  }
  console.log(pendingTable.toString());
}
