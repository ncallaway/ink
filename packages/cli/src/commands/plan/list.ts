import { Command } from "commander";
import Table from "cli-table3";
import chalk from "chalk";
import { lib, BackupPlan, TrackQueue, TrackQueueStatus } from "@ink/shared";
import { unwrapOrExit } from "../../utils/unwrap";

export const planList = (parent: Command) => {
  parent
    .command('list')
    .description('List all backup plans')
    .option('--status <status>', 'Filter by status (draft, pending, in_progress, completed)')
    .option('--type <type>', 'Filter by type (movie, tv)')
    .option('--order <field>', 'Sort order (title, updated, status)', 'updated')
    .action(run);
}

const TRACK_QUEUE: TrackQueue[] = ['extract', 'transcode', 'review', 'copy'];

type TrackQueueStatusCount = Record<TrackQueue, Record<TrackQueueStatus, number>>;

async function run(options: { status?: string, type?: string, order: string }) {

  const ids = unwrapOrExit(await lib.storage.listAllPlanFiles(), 1);

  const plans: { plan: BackupPlan, status: string, queueCounts: TrackQueueStatusCount }[] = [];

  // Read all files and calculate status
  for (const discId of ids) {
    const planRes = await lib.storage.readPlan(discId);
    if (planRes.isErr()) {
      console.warn(`Could not read plan ${discId} due to error`, planRes.error);
      continue;
    }

    const plan = planRes.value;

    const queueCounts: TrackQueueStatusCount = {
      extract: { ineligible: 0, done: 0, ready: 0, running: 0, error: 0, blocked: 0 },
      transcode: { ineligible: 0, done: 0, ready: 0, running: 0, error: 0, blocked: 0 },
      review: { ineligible: 0, done: 0, ready: 0, running: 0, error: 0, blocked: 0 },
      copy: { ineligible: 0, done: 0, ready: 0, running: 0, error: 0, blocked: 0 }
    }

    let status: string = plan.status;

    // Calculate dynamic status if not draft
    if (status !== 'draft') {
      let allCompleted = true;
      let anyStarted = false;
      let anyError = false;

      for (const t of plan.tracks) {
        const tsRes = await lib.tracks.state(plan, t);
        if (tsRes.isOk()) {
          const ts = tsRes.value;

          for (const q of TRACK_QUEUE) {
            const status = ts.queues[q];
            queueCounts[q][status]++;
          }

          if (ts.status !== 'complete') { allCompleted = false; }
          if (ts.status !== 'ready') { anyStarted = true; }
          if (ts.status === 'error') { anyError = true; }
        }
      }

      if (allCompleted && plan.tracks.length > 0) { status = 'completed'; }
      else if (anyError) { status = 'error'; }
      else if (anyStarted) { status = 'in_progress'; }
      else { status = 'pending'; }
    }

    plans.push({ plan, status, queueCounts });
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

  const listTable = new Table({
    head: ['Status', 'Disc ID', 'Disc Name', 'Type', 'Tracks'],
    style: { head: [] },
  });
    

  // Display
  for (const item of filtered) {
    const { plan, status } = item;
    let statusColor = chalk.gray;
    if (status === 'completed') { statusColor = chalk.green; }
    else if (status === 'in_progress') { statusColor = chalk.cyan; }
    else if (status === 'pending') { statusColor = chalk.yellow; }
    else if (status === 'draft') { statusColor = chalk.blue; }
    else if (status === 'error') { statusColor = chalk.red; }

    const type = plan.type === 'movie' ? 'Movie' : 'TV';
    const tracks = plan.tracks.length.toString();

    listTable.push([
      statusColor(status),
      chalk.gray(plan.discId),
      plan.discLabel,
      type,
      tracks
    ]);

    if (status !== 'completed') {
      let msg = [] 
      for (const q of TRACK_QUEUE) {
        const queueName = lib.fmt.trackQueue(q);
        const eligibleCount = plan.tracks.length - item.queueCounts[q].ineligible;
        const doneCount = item.queueCounts[q].done;
        const runningCount = item.queueCounts[q].running;

        const isDone = doneCount === eligibleCount;
        const isStarted = doneCount > 0 || runningCount > 0;

        if (eligibleCount) {
          if (isDone) {
            msg.push(chalk.green(`[${queueName}]`));
          }
          else if (isStarted) {
            msg.push(chalk.white(`[${queueName} ${chalk.green(doneCount)}/${eligibleCount}]`));
          }
          else {
            msg.push(chalk.white(`[${queueName}]`));
          }
        }
      }

      if (msg.length) {
        listTable.push([ "", { colSpan: 4, content: msg.join(chalk.gray(" | ")) } ]);
      }
    }

  }

  console.log(listTable.toString());
}
