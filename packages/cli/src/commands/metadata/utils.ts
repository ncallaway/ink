import * as path from "path";
import * as os from "os";
import * as fs from "fs/promises";
import chalk from "chalk";
import { DiscMetadata } from "@ink/shared";

export const getMetadataDir = () => path.join(os.homedir(), '.ink', 'metadata');

export const getMetadataPath = (discId: string) => path.join(getMetadataDir(), `${discId}.json`);

export async function loadMetadata(discId: string): Promise<DiscMetadata | null> {
    try {
        const content = await fs.readFile(getMetadataPath(discId), 'utf-8');
        return JSON.parse(content) as DiscMetadata;
    } catch {
        return null;
    }
}

export function displayMetadata(metadata: DiscMetadata) {
  // Use userProvidedName if available, else volumeLabel
  const title = metadata.userProvidedName || metadata.volumeLabel || "Unknown Title";
  
  console.log(chalk.bold(`
Title: ${title}`));
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

  

  export interface TvMazeShow {

      id: number;

      name: string;

      premiered: string; // YYYY-MM-DD

  }

  

  export interface TvMazeEpisode {

      id: number;

      season: number;

      number: number;

      name: string;

  }

  

  export async function searchTvMaze(query: string): Promise<TvMazeShow[]> {

      try {

          const url = `https://api.tvmaze.com/search/shows?q=${encodeURIComponent(query)}`;

          const response = await fetch(url);

          if (!response.ok) return [];

          const data = await response.json() as any[];

          return data.map(item => ({

              id: item.show.id,

              name: item.show.name,

              premiered: item.show.premiered

          }));

      } catch {

          return [];

      }

  }

  

  export async function getTvMazeEpisodes(showId: number): Promise<TvMazeEpisode[]> {

      try {

          const url = `https://api.tvmaze.com/shows/${showId}/episodes`;

          const response = await fetch(url);

          if (!response.ok) return [];

          const data = await response.json() as any[];

          return data.map(item => ({

              id: item.id,

              season: item.season,

              number: item.number,

              name: item.name

          }));

      } catch {

          return [];

      }

  }

  