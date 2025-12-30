import * as readline from "node:readline";
import { Command } from "commander";
import * as fs from "fs/promises";
import * as path from "path";
import { platform } from "os";
import chalk from "chalk";
import ora from "ora";
import { lib, DriveStatus, DevicePath } from "@ink/shared";
import watcher from "@parcel/watcher";

export const runExtract = (parent: Command) => {
  parent
    .command('extract')
    .description('Process extraction queue for inserted discs (Continuous Loop)')
    .action(run);
}

interface DriveState {
  status: DriveStatus;
  processedDiscId?: string;
  lastCheck: number;
}

const driveStates = new Map<string, DriveState>();

async function run() {
  console.log(chalk.blue("Starting extraction loop... (Press Ctrl+C to exit)"));
  
  // 1. Setup Watcher
  const plansDir = lib.paths.plans();
  await fs.mkdir(plansDir, { recursive: true });
  
  let planSubscription: watcher.AsyncSubscription | undefined;
  
  try {
      let backend;
      const os = platform();
      if (os === 'linux') backend = 'inotify';
      else if (os === 'darwin') backend = 'fs-events';
      else if (os === 'win32') backend = 'windows';

      planSubscription = await watcher.subscribe(plansDir, (err, events) => {
        if (err) {
            console.error(chalk.red("Error watching plans directory:"), err);
            return;
        }
        // If plans change, we might need to re-process drives that were waiting for a plan
        if (events.length > 0) {
            console.log(chalk.gray("Plan change detected. Re-evaluating drives..."));
            // Reset 'processedDiscId' for drives that might have been skipped due to missing plan
            // Actually, simply clearing processedDiscId for all PRESENT drives is safest
            // but might re-scan metadata. 
            // Better: We let the poll loop handle it. We just need to signal 'recheck needed'.
            // For simplicity, we clear the processed flag so processDrive runs again.
            // processDrive is smart enough (idempotent) to not re-extract if already extracting.
            for (const [path, state] of driveStates.entries()) {
                if (state.status === DriveStatus.DISK_PRESENT) {
                    driveStates.set(path, { ...state, processedDiscId: undefined });
                }
            }
        }
      }, { backend });
  } catch (e) {
      console.warn(chalk.yellow("Could not setup file watcher (is polling enabled?):"), e);
  }

  // 2. Setup Loop
  const pollInterval = 5000;
  let isRunning = true;

  process.on('SIGINT', () => {
    console.log(chalk.yellow("\nStopping extraction loop..."));
    isRunning = false;
    if (planSubscription) planSubscription.unsubscribe();
    process.exit(0);
  });

  while (isRunning) {
    await pollDrives();
    await new Promise(resolve => setTimeout(resolve, pollInterval));
  }
}

async function pollDrives() {
    const drivesResult = lib.drive.list();
    if (drivesResult.isErr()) {
        console.error(chalk.red(`Error listing drives: ${drivesResult.error.message}`));
        return;
    }

    const drives = drivesResult.value;

    for (const drivePath of drives) {
        // Get hardware status
        const statusRes = lib.drive.status(drivePath);
        if (statusRes.isErr()) continue;
        const currentStatus = statusRes.value;

        // Get or Init State
        const prevState = driveStates.get(drivePath) || { 
            status: DriveStatus.NO_INFO, 
            lastCheck: 0 
        };

        // State Machine
        if (currentStatus === DriveStatus.DISK_PRESENT) {
            // If the drive just became ready (transition from Empty/Open)
            // But skip the delay if this is the VERY FIRST check (NO_INFO -> DISK_PRESENT)
            // because the disc has likely been sitting there.
            if (prevState.status !== DriveStatus.DISK_PRESENT && prevState.status !== DriveStatus.NO_INFO) {
                console.log(chalk.yellow(`New disc detected in ${drivePath}. Waiting for drive to settle...`));
                // Update state to DISK_PRESENT but don't process yet. 
                // The next poll cycle (in ~5s) will see it as DISK_PRESENT + Unprocessed and trigger the flow.
                driveStates.set(drivePath, { 
                    status: currentStatus, 
                    processedDiscId: undefined, 
                    lastCheck: Date.now() 
                });
                continue;
            }

            // If it IS present, and we haven't processed it yet (or reset it)
            if (!prevState.processedDiscId) {
                console.log(chalk.green(`\nProcessing disc in ${drivePath}...`));
                
                // Process
                const spinner = ora(`Processing ${drivePath}...`).start();
                try {
                    // We don't have the disc ID yet, processDrive returns it potentially?
                    // lib.processing.extract.processDrive returns Result<void> usually.
                    // If it succeeds, we assume it handled it.
                    const res = await lib.processing.extract.processDrive(drivePath, namePrompt, { spinner });
                    
                    if (res.isOk()) {
                         // Mark as processed. 
                         // Note: We don't strictly know the DiscID here unless processDrive returns it.
                         // For now, setting processedDiscId to "unknown" prevents looping.
                         // Ideally processDrive should return the DiscID.
                         driveStates.set(drivePath, { 
                             status: currentStatus, 
                             processedDiscId: "processed", 
                             lastCheck: Date.now() 
                         });
                         spinner.succeed(`Finished processing cycle for ${drivePath}`);
                    } else {
                        spinner.fail(`Error processing ${drivePath}: ${res.error.message}`);
                        // Don't mark as processed, so we retry? Or mark as error to avoid loop spam?
                        // Let's retry on next poll if it was a transient error, but maybe add a delay or backoff?
                        // For now, we update state so we don't spam IMMEDIATELY, but next change will retry.
                        driveStates.set(drivePath, { 
                            status: currentStatus, 
                            processedDiscId: "error", 
                            lastCheck: Date.now() 
                        });
                    }
                } catch (e) {
                    spinner.fail(`Unexpected error on ${drivePath}: ${e}`);
                }
            }
        } else {
            // Drive is Empty or Open
            if (prevState.status === DriveStatus.DISK_PRESENT) {
                console.log(chalk.gray(`Drive ${drivePath} is now empty/open.`));
            }
            // Reset state
            driveStates.set(drivePath, { 
                status: currentStatus, 
                processedDiscId: undefined, 
                lastCheck: Date.now() 
            });
        }
    }
}

const namePrompt = async (label: string | undefined) => {
  // Beep or visual cue?
  process.stdout.write('\x07'); 
  let discName: string = "";
  while (!discName) {
    discName = await promptUserForName(label);
  }
  return discName;
}

const promptUserForName = async (defaultName: string | undefined): Promise<string> => {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => {
    const msg = defaultName ? `Enter a name for this disc (default \`${defaultName}\`)` : "Enter a name for this disc";
    rl.question(chalk.yellow(`\n${msg}: `), (answer) => {
      rl.close();
      resolve(answer.trim() || defaultName || "");
    });
  });
}
