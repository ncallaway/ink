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

    // Stage Status Logic
    const stages = [
        { name: 'EXTRACT', eligible: t.extract, done: status === 'extracted' || status === 'encoded' || status === 'reviewed' || status === 'completed', ready: status === 'pending' },
        { name: 'TRANSCODE', eligible: t.extract, done: status === 'encoded' || status === 'reviewed' || status === 'completed', ready: status === 'extracted' },
        { name: 'REVIEW', eligible: plan.type === 'tv', done: status === 'reviewed' || status === 'completed', ready: (status === 'extracted' || status === 'encoded') && !hasReviewedFile },
        { name: 'COPY', eligible: t.extract, done: status === 'completed', ready: (status === 'encoded' || status === 'reviewed') && (plan.type === 'movie' || hasReviewedFile) }
    ];

    const stageDisplay = stages.map(s => {
        if (!s.eligible) return chalk.dim(s.name);
        if (s.done) return chalk.green(s.name);
        if (s.ready) return chalk.cyan(s.name); // Using cyan for "light green/ready"
        return chalk.white(s.name);
    }).join(chalk.gray(" | "));

    // Banner Logic
    let banner = "";
    const eligibleStages = stages.filter(s => s.eligible);
    const completedStages = eligibleStages.filter(s => s.done);
    
    if (completedStages.length === eligibleStages.length) {
        banner = chalk.bgGreen.black(" COMPLETE ");
    } else if (completedStages.length > 0) {
        banner = chalk.bgCyan.black(" IN PROGRESS ");
    } else {
        banner = chalk.bgWhite.black(" UNSTARTED ");
    }

    console.log(`\n${banner} ${chalk.white(`Track ${t.trackNumber} : ${t.output.filename}`)}${resolvedName}`);
    console.log(`  ${stageDisplay}`);
    console.log(chalk.gray(`  Target Dir: ${t.output.directory}`));
    if (t.transcode) {
        console.log(chalk.gray(`  Transcode: ${t.transcode.codec} (${t.transcode.preset}, CRF ${t.transcode.crf})`));
    }
  }
}
