import * as readline from "node:readline";
import { Command } from "commander";
import * as fs from "fs/promises";
import * as path from "path";
import chalk from "chalk";
import ora from "ora";
import { lib, DriveStatus, DevicePath } from "@ink/shared";
import { loadPlan } from "../plan/utils";
import { formatDuration, calculateEta } from "./time";
import { ensureDirs, getExtractedDir, getExtractedPath, hasStatus, writeStatus } from "./utils";

export const runExtract = (parent: Command) => {
  parent
    .command('extract')
    .description('Process extraction queue for inserted discs')
    .action(run);
}

async function run() {
  const spinner = ora('Checking drives...').start();

  // 1. List Drives
  const drivesResult = lib.drive.list();
  if (drivesResult.isErr()) {
    spinner.fail(`Error listing drives: ${drivesResult.error.message}`);
    return;
  }

  const drives = drivesResult.value;
  if (drives.length === 0) {
    spinner.info('No drives found.');
    return;
  }

  let processedAny = false;

  for (const drive of drives) {
    await lib.processing.extract.processDrive(drive, namePrompt, {spinner});
  }

  if (!processedAny) {
    console.log("No pending extractions found for inserted discs.");
  }
}

const namePrompt = async (label: string | undefined) => {
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
