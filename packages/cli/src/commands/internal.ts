import { Command } from "commander";
import { DevicePath, lib, DriveStatus } from "@ink/shared";
import { makemkv } from "../../../shared/src/makemkv";

export const defineInternal = (program: Command) => {
  const internal = program.command('internal').description("A collection of internal utilities useful for verification");
  /* @ts-expect-error: hidden isn't a real variable on Command */
  internal.hidden = true;

  internal
    .command('disc-detect')
    .action(async () => {
      const detectResult = await lib.disc.detect();
      if (detectResult.isOk()) {
        console.log("Detect Result (OK): ", detectResult.value);
      } else {
        console.error("Detect Result (ERR): ", detectResult.error);
      }
    });

  internal
    .command('disc-identify')
    .option('--dev <device>', 'Specify the device holding the disc to identify')
    .action(async (options: { dev: DevicePath }) => {
      const result = await lib.disc.identify(options.dev);
      if (result.isOk()) {
        console.log("Result (OK): ", result.value);
      } else {
        console.error("Result (ERR): ", result.error);
      }
    });

  internal
    .command('makemkv-drivescan')
    .action(async () => {
      const {stdout}= await makemkv.driveScan();
      console.log("makemkv stdout", stdout);
    });

  internal
    .command('drive-status')
    .requiredOption('--dev <device>', 'Specify the device to check status for')
    .action((options: { dev: string }) => {
      const result = lib.drive.status(options.dev);
      if (result.isOk()) {
        console.log(`Drive Status (OK): ${result.value} (${DriveStatus[result.value]})`);
      } else {
        console.error("Drive Status (ERR): ", result.error);
      }
    });
}
