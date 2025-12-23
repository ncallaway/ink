import * as path from "path";
import * as os from "os";
import * as fs from "fs/promises";
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
