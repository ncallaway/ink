import { Command } from "commander";
import * as fs from "fs/promises";
import * as readline from "node:readline";
import ora, { Ora } from "ora";
import chalk from "chalk";
import { DevicePath, DiscMetadata, DriveStatus, lib } from "@ink/shared";
import { displayMetadata } from "./utils";
import { unwrapOrExit } from "../../utils/unwrap";

export const metadataRead = (parent: Command) => {
  parent
    .command('read')
    .description('Read the metadata from the currently inserted disc')
    .option('--no-cache', 'Ignore cached metadata and force re-scan')
    .option('--dev <device>', 'Specify device to scan (e.g., /dev/sr0)')
    .action(run);
}

interface ReadOptions {
  cache: boolean;
  dev?: DevicePath;
}

const run = async (options: ReadOptions) => {
  const spinner = ora('Checking for disc...').start();

  try {
    // 1 - select the device to use (may be defined by the options)
    const device = await selectDevice(spinner, options);
    if (!device) {
      spinner.fail("No device was detected");
      process.exit(1);
    }

    // 2 - wait for the device to be ready 
    await waitForDevice(spinner, device);

    // 3 - read and save metadata from disc
    const metadataRes = await lib.metadata.readFromDisc(device, {
      spinner,
      force: options.cache === false
    });

    const metadata = unwrapOrExit(metadataRes, 3);

    if (!metadata.userProvidedName) {
      // Prompt user for name
      spinner.stop();
      const userTitle = await promptUserForName(metadata.volumeLabel);
      metadata.userProvidedName = userTitle;
      spinner.start('Saving final metadata...');

      await lib.storage.saveMetadata(metadata.discId, metadata);
      spinner.succeed(`Saved metadata for ${metadata.userProvidedName}`);
    }

    displayMetadata(metadata);

  } catch (error: any) {
    spinner.fail(`Error: ${error.message}`);
    if (process.env.DEBUG) console.error(error);
  }
}

async function promptUserForName(defaultName: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => {
    rl.question(chalk.yellow(`\nEnter a name for this disc (default: ${defaultName}): `), (answer) => {
      rl.close();
      resolve(answer.trim() || defaultName);
    });
  });
}

async function saveMetadata(dir: string, filepath: string, data: DiscMetadata) {
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(filepath, JSON.stringify(data, null, 2));
}


// Helper types for parsing


const selectDevice = async (spinner: Ora, options: ReadOptions): Promise<DevicePath> => {
  let device: DevicePath = options.dev as DevicePath;

  // 1. Detect device if not provided
  if (!device) {
    const drivesResult = lib.drive.list();
    if (drivesResult.isErr()) {
      spinner.fail(`Could not list drives: ${drivesResult.error.message}`);
      process.exit(101);
    }

    const drives = drivesResult.value;
    if (drives.length === 0) {
      spinner.fail('No optical drives found on this system.');
      process.exit(1);
    }

    // Default to the first drive found
    // TODO: Handle multiple drives selection or parallel processing in future
    if (drives.length > 0) {
      device = drives[0] as DevicePath;
    }
  }

  return device;
}

const waitForDevice = async (spinner: Ora, device: DevicePath) => {
  spinner.text = `Checking status of ${device}...`;
  let attempts = 0;
  const maxAttempts = 60; // 60 seconds

  while (attempts < maxAttempts) {
    const statusResult = lib.drive.status(device);

    if (statusResult.isErr()) {
      // If we can't even check status (e.g. permission denied), fail
      spinner.fail(`Failed to check drive status: ${statusResult.error.message}`);
      process.exit(1);
    }

    const status = statusResult.value;

    if (status === DriveStatus.DISK_PRESENT) {
      // Ready!
      // if the device was ready on the first attempt, stop waiting immediately. If the device *just* became ready, wait
      // an extra 2 seconds, because we often can't mount the drive the moment it transitions to disk_present
      if (attempts > 0) {
        spinner.text = `Drive ${device} is present, waiting 5s to mount it`;
        await new Promise(r => setTimeout(r, 5000));
      }
      break;
    } else if (status === DriveStatus.READING) {
      // Drive is busy/spinning up
      spinner.text = `Drive ${device} is reading... (Attempt ${attempts + 1}/${maxAttempts})`;
      await new Promise(r => setTimeout(r, 1000));
      attempts++;
    } else if (status === DriveStatus.NO_DISK || status === DriveStatus.TRAY_OPEN) {
      spinner.fail(`Drive ${device} is empty or open.`);
      process.exit(2);
    } else {
      spinner.fail(`Drive ${device} returned unknown status: ${status}`);
      process.exit(1);
    }
  }

  if (attempts >= maxAttempts) {
    spinner.fail(`Timed out waiting for drive ${device} to become ready.`);
    process.exit(1);
  }
}


