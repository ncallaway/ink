import { exec } from 'child_process';
import { promisify } from 'util';
import { ok, err, Result } from 'neverthrow';

const execAsync = promisify(exec);

const driveScan = async () => await execAsync('makemkvcon -r info disc:9999');

const runInfo = async (driveIndex: number): Promise<string> => {
  // Increase maxBuffer for large metadata, and set minlength to 0 to capture all tracks
  const { stdout } = await execAsync(`makemkvcon -r --minlength=0 --cache=1 info disc:${driveIndex}`, { maxBuffer: 1024 * 1024 * 10 });
  return stdout;
};

const findDriveIndex = async (devicePath: string): Promise<Result<number, Error>> => {
  try {
    const { stdout } = await driveScan();
    const lines = stdout.split('\n');

    for (const line of lines) {
      if (line.startsWith('DRV:')) {
        const parts = parseCsvLine(line.substring(4));
        const index = parseInt(parts[0]);
        const detectedPath = parts[6];

        if (detectedPath === devicePath) {
          return ok(index);
        }
      }
    }

    return err(new Error(`Device ${devicePath} not found in MakeMKV drive scan`));
  } catch (e) {
    return err(e as Error);
  }
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

export const makemkv = {
  driveScan,
  runInfo,
  findDriveIndex,
  parseCsvLine
}
