import { ok, err, Result } from 'neverthrow';
import { makemkv } from '../makemkv';
import { DevicePath } from '../types';

export async function detect(): Promise<Result<DevicePath, Error>> {
  try {
    // Scan for drives using MakeMKV
    const { stdout } = await makemkv.driveScan();

    const lines = stdout.split('\n');

    for (const line of lines) {
      if (line.startsWith('DRV:')) {
        const parts = parseCsvLine(line.substring(4));
        const discName = parts[5];
        const devicePath = parts[6];

        if (discName && devicePath) {
          return ok(devicePath as DevicePath);
        }
      }
    }
  } catch (e) {
    console.warn("Received unknown error: ", e);
    return err(e as Error);
  }

  return err(new Error("No disc was detected"));
}

function parseCsvLine(line: string): string[] {
    const result: string[] = [];
    let current = '';
    let inQuote = false;
    
    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"') {
            inQuote = !inQuote;
        } else if (char === ',' && !inQuote) {
            result.push(current);
            current = '';
        } else {
            current += char;
        }
    }
    result.push(current);
    return result.map(s => s.replace(/^"|"$/g, '')); // Strip quotes
}
