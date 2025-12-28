import { Command } from "commander";
import { runExtract } from "./extract";
import { runTranscode } from "./transcode";
import { runCopy } from "./copy";
import { runReview } from "./review";

export const defineCommand = (parent: Command) => {
  const run = parent.command('run').description('Run backup pipeline queues');

  runExtract(run);
  runTranscode(run);
  runCopy(run);
  runReview(run);
}
