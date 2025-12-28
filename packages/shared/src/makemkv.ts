import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import { ok, err, Result } from 'neverthrow';

const execAsync = promisify(exec);

const driveScan = async () => await execAsync('makemkvcon -r info disc:9999');

const runInfo = async (driveIndex: number): Promise<string> => {
  // Increase maxBuffer for large metadata, and set minlength to 0 to capture all tracks
  const { stdout } = await execAsync(`makemkvcon -r --minlength=0 --cache=1 info disc:${driveIndex}`, { maxBuffer: 1024 * 1024 * 10 });
  return stdout;
};

export interface ProgressUpdate {
    message?: string;
    percentage?: number;
}

const extractTitle = (
    driveIndex: number, 
    titleIndex: number, 
    outputDir: string,
    onProgress?: (update: ProgressUpdate) => void
): Promise<Result<void, Error>> => {
    return new Promise((resolve) => {
        const child = spawn('makemkvcon', [
            '-r', 
            '--progress=-stdout', 
            'mkv', 
            `disc:${driveIndex}`, 
            titleIndex.toString(), 
            outputDir
        ]);

        let stderrOutput = '';
        let stdoutBuffer = '';
        let currentStageName = '';

        child.stdout.on('data', (data) => {
            const chunk = data.toString();
            stdoutBuffer += chunk;
            
            const lines = chunk.split('\n');
            for (const line of lines) {
                if (line.startsWith('PRGV:')) {
                    // PRGV:current,total,max
                    const parts = line.substring(5).split(',');
                    const current = parseInt(parts[0]);
                    const max = parseInt(parts[2]);
                    
                    if (!isNaN(current) && !isNaN(max) && max > 0) {
                        const percentage = (current / max) * 100;
                        onProgress?.({ percentage, message: currentStageName });
                    }
                } else if (line.startsWith('PRGC:')) {
                    // PRGC:code,id,name
                    const parts = parseCsvLine(line.substring(5));
                    currentStageName = parts[2];
                    onProgress?.({ message: currentStageName, percentage: 0 });
                } else if (line.startsWith('PRGT:')) {
                    // PRGT:code,id,name - Title group
                     const parts = parseCsvLine(line.substring(5));
                     currentStageName = parts[2];
                     onProgress?.({ message: currentStageName, percentage: 0 });
                }
            }
        });

        child.stderr.on('data', (data) => {
            stderrOutput += data.toString();
        });

        child.on('close', (code) => {
            if (code === 0) {
                // Check for failure messages in stdout even if exit code is 0
                if (stdoutBuffer.includes('failed') && !stdoutBuffer.includes('0 failed')) {
                     // Try to find the specific error
                     const errorMatch = stdoutBuffer.match(/MSG:5004.*?,(\d+) failed"/);
                     if (errorMatch && errorMatch[1] !== '0') {
                         resolve(err(new Error(`MakeMKV reported ${errorMatch[1]} failures.`)));
                         return;
                     }
                }
                resolve(ok(undefined));
            } else {
                resolve(err(new Error(`MakeMKV exited with code ${code}. Stderr: ${stderrOutput}`)));
            }
        });

        child.on('error', (error) => {
            resolve(err(error));
        });
    });
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
  extractTitle,
  findDriveIndex,
  parseCsvLine
}
