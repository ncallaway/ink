import * as path from "path";
import * as os from "os";
import * as fs from "fs/promises";
import chalk from "chalk";
import { BackupPlan } from "@ink/shared";

export const getPlansDir = () => path.join(os.homedir(), '.ink', 'plans');

export const getPlanPath = (discId: string) => path.join(getPlansDir(), `${discId}.json`);

export async function savePlan(plan: BackupPlan) {
    const dir = getPlansDir();
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(getPlanPath(plan.discId), JSON.stringify(plan, null, 2));
}

export async function loadPlan(discId: string): Promise<BackupPlan | null> {
    try {
        const content = await fs.readFile(getPlanPath(discId), 'utf-8');
        return JSON.parse(content) as BackupPlan;
    } catch {
        return null;
    }
}

import { getTrackStatus, getReviewedStatusPath, hasStatus } from "../run/utils";

// ... existing imports ...

export async function displayPlan(plan: BackupPlan) {
  console.log(chalk.bold(`
Plan: ${plan.title}`));
  console.log(chalk.gray(`File: ${getPlanPath(plan.discId)}`));
  console.log(chalk.gray(`Disc ID: ${plan.discId}`));
  console.log(chalk.gray(`Status: ${plan.status}`)); // This is the stored status, maybe we should update it dynamically too?
  console.log(chalk.gray(`Type: ${plan.type}`));
  console.log(`Planned Tracks: ${plan.tracks.length}`);

  for (const t of plan.tracks) {
    const status = await getTrackStatus(plan.discId, t.trackNumber);
    let statusStr = "";
    let resolvedName = "";

    // Check for resolved name
    const reviewedPath = getReviewedStatusPath(plan.discId, t.trackNumber);
    if (await hasStatus(reviewedPath)) {
        try {
            const data = JSON.parse(await fs.readFile(reviewedPath, 'utf-8'));
            if (data.finalName) {
                resolvedName = chalk.green(` -> ${data.finalName}`);
            }
        } catch {}
    }

    if (status === 'completed') statusStr = chalk.green(" [Completed]");
    else if (status === 'reviewed') statusStr = chalk.green(" [Reviewed]");
    else if (status === 'encoded') statusStr = chalk.cyan(" [Encoded]");
    else if (status === 'extracted') statusStr = chalk.blue(" [Extracted]");
    else statusStr = chalk.gray(" [Pending]");

    console.log(chalk.white(`  Track ${t.trackNumber} : ${t.output.filename}`) + resolvedName + statusStr);
    console.log(chalk.gray(`    Target Dir: ${t.output.directory}`));
    if (t.transcode) {
        console.log(chalk.gray(`    Transcode: ${t.transcode.codec} (${t.transcode.preset}, CRF ${t.transcode.crf})`));
    } else {
        console.log(chalk.gray(`    Transcode: (Default)`));
    }
  }
}
