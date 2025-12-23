import * as path from "path";
import * as os from "os";
import chalk from "chalk";
import { DiscMetadata } from "@ink/shared";

export const getMetadataDir = () => path.join(os.homedir(), '.ink', 'metadata');

export const getMetadataPath = (discId: string) => path.join(getMetadataDir(), `${discId}.json`);

export function displayMetadata(metadata: DiscMetadata) {
  // Use userProvidedName if available, else volumeLabel
  const title = metadata.userProvidedName || metadata.volumeLabel || "Unknown Title";
  
  console.log(chalk.bold(`\nTitle: ${title}`));
  console.log(chalk.gray(`ID: ${metadata.discId}`));
  console.log(`Tracks: ${metadata.tracks.length}`);

  metadata.tracks.forEach(t => {
    const sizeMb = (t.size / 1024 / 1024).toFixed(0);
    console.log(chalk.white(`  Track ${t.trackNumber}: ${t.duration} (${sizeMb} MB)`));
    const audioCount = t.audio ? t.audio.length : 0;
    const subsCount = t.subtitles ? t.subtitles.length : 0;
    console.log(chalk.gray(`    Audio: ${audioCount} tracks, Subs: ${subsCount} tracks`));
  });
}
