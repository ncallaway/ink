import { Ora } from 'ora';
import watcher from "@parcel/watcher";
import { paths } from "../../paths";
import * as fs from "fs/promises";
import { drive } from "../../drive";
import { DriveStatus } from "../../types";
import { processDrive } from "./processDrive";
import { MetadataPromptFn } from '../../metadata/readFromDisc';

export interface DriveState {
  status: DriveStatus;
  processedDiscId?: string;
  lastCheck: number;
}

const sleep = async (timeout: number) => new Promise(resolve => setTimeout(resolve, timeout));

export type RunExtractOptions = {
  spinner?: Ora;
}

export const run = async (namePrompt: MetadataPromptFn, options: RunExtractOptions = {}) => {
  const plansDir = paths.plans();
  await fs.mkdir(plansDir, { recursive: true });
  
  let planSubscription: watcher.AsyncSubscription | undefined;
  
  try {
      planSubscription = await watcher.subscribe(plansDir, (err, events) => {
        if (err) {
            console.error("Error watching plans directory:", err);
            return;
        }
        // If plans change, we might need to re-process drives that were waiting for a plan
        if (events.length > 0) {
            console.log("Plan change detected. Re-evaluating drives...");
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
      });
  } catch (e) {
      console.warn("Could not setup file watcher (is polling enabled?):", e);
  }

  // 2. Setup Loop
  const pollInterval = 3000;
  let isRunning = true;

  process.on('SIGINT', () => {
    console.log("Stopping extraction loop...");
    isRunning = false;
    if (planSubscription) planSubscription.unsubscribe();
    process.exit(0);
  });

  const driveStates = new Map<string, DriveState>();

  while (isRunning) {
    await pollDrives(driveStates, namePrompt, options);
    await sleep(pollInterval);
  }
}


async function pollDrives(driveStates: Map<string, DriveState>, namePrompt: MetadataPromptFn, options: RunExtractOptions) {
  const { spinner } = options;
    const drivesResult = drive.list();
    if (drivesResult.isErr()) {
        console.error(`Error listing drives: ${drivesResult.error.message}`);
        return;
    }

    const drives = drivesResult.value;

    for (const drivePath of drives) {
        // Get hardware status
        const statusRes = drive.status(drivePath);
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
                console.log(`New disc detected in ${drivePath}. Waiting for drive to settle...`);
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
                console.log(`Processing disc in ${drivePath}...`);
                
                // Process
                spinner?.start(`Processing ${drivePath}...`);
                try {
                    // We don't have the disc ID yet, processDrive returns it potentially?
                    // lib.processing.extract.processDrive returns Result<void> usually.
                    // If it succeeds, we assume it handled it.
                    const res = await processDrive(drivePath, namePrompt, { spinner });
                    
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
                         spinner?.succeed(`Finished processing cycle for ${drivePath}`);
                    } else {
                        spinner?.fail(`Error processing ${drivePath}: ${res.error.message}`);
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
                    spinner?.fail(`Unexpected error on ${drivePath}: ${e}`);
                }
            }
        } else {
            // Drive is Empty or Open
            if (prevState.status === DriveStatus.DISK_PRESENT) {
                console.log(`Drive ${drivePath} is now empty/open.`);
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
