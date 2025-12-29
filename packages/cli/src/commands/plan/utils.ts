import * as fs from "fs/promises";
import chalk from "chalk";
import { lib, BackupPlan, DiscId, TrackQueue, TrackStatus } from "@ink/shared";


export async function savePlan(plan: BackupPlan) {
    const dir = lib.paths.plans();
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(lib.paths.plan(plan.discId), JSON.stringify(plan, null, 2));
}

export async function loadPlan(discId: DiscId): Promise<BackupPlan | null> {
    try {
        const content = await fs.readFile(lib.paths.plan(discId), 'utf-8');
        return JSON.parse(content) as BackupPlan;
    } catch {
        return null;
    }
}

import { getTrackStatus, getReviewedStatusPath, hasStatus } from "../run/utils";

export async function displayPlan(plan: BackupPlan) {
  console.log(chalk.bold(`
Plan: ${plan.title}`));
  console.log(chalk.gray(`File: ${lib.paths.plan(plan.discId)}`));
  console.log(chalk.gray(`Disc ID: ${plan.discId}`));
  console.log(chalk.gray(`Status: ${plan.status}`)); 
  console.log(chalk.gray(`Type: ${plan.type}`));
  console.log(`Planned Tracks: ${plan.tracks.length}`);

  for (const t of plan.tracks) {
    const status = await getTrackStatus(plan.discId, t.trackNumber);
    let resolvedName = "";

    // Check for resolved name
    const reviewedPath = getReviewedStatusPath(plan.discId, t.trackNumber);
    const hasReviewedFile = await hasStatus(reviewedPath);
    if (hasReviewedFile) {
        try {
            const data = JSON.parse(await fs.readFile(reviewedPath, 'utf-8'));
            if (data.finalName) {
                resolvedName = chalk.green(` -> ${data.finalName}`);
            }
        } catch {}
    }

    const stateRes = await lib.tracks.state(plan, t);

    let stageDisplay: string = "";
    if (stateRes.isOk()) {
      const queues = Object.keys(stateRes.value.queues) as TrackQueue[]
      const stages = queues.map(q => lib.fmt.trackQueueStatus(q, stateRes.value.queues[q]));
      stageDisplay = stages.join(chalk.gray(" | "));
    } else {
      stageDisplay = chalk.red(`Error getting status: ${stateRes.error.message}`);
    }

    // Banner Logic
    let banner = "";
    if (stateRes.isOk()) {
      banner = lib.fmt.trackStatus(stateRes.value.status);
    } else {
      banner = chalk.red('ERROR')
    }

    console.log(`\n${banner} ${chalk.white(`Track ${t.trackNumber} : ${t.output.filename}`)}${resolvedName}`);
    if (stateRes.isOk() && stateRes.value.status !== 'complete') {
      console.log(`  ${stageDisplay}`);
    }
    console.log(chalk.gray(`  Target Dir: ${t.output.directory}`));
    if (t.transcode) {
        console.log(chalk.gray(`  Transcode: ${t.transcode.codec} (${t.transcode.preset}, CRF ${t.transcode.crf})`));
    }
  }
}
