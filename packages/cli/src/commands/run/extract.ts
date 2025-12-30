import * as readline from "node:readline";
import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { lib, DriveStatus, DevicePath } from "@ink/shared";

export const runExtract = (parent: Command) => {
  parent
    .command('extract')
    .description('Process extraction queue for inserted discs (Continuous Loop)')
    .action(run);
}

async function run() {
  console.log(chalk.blue("Starting extraction loop... (Press Ctrl+C to exit)"));
  const spinner = ora();
  
  // 1. Setup Watcher
  await lib.processing.extract.run(namePrompt, { spinner });
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
