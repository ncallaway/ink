import { spawn } from 'child_process';
import { ok, err, Result } from 'neverthrow';
import { TranscodeSettings } from './types';

export interface TranscodeProgress {
    percentage?: number;
    fps?: number;
    speed?: string;
    time?: string;
    stage?: string;
}

export const transcode = (
    inputPath: string, 
    outputPath: string, 
    totalDurationSeconds?: number,
    settings?: TranscodeSettings,
    onProgress?: (progress: TranscodeProgress) => void
): Promise<Result<void, Error>> => {
    return new Promise((resolve) => {
        // Agreed defaults for high-quality, size-efficient, portable backups
        const args = [
            '-y', 
            '-fflags', '+genpts', // Smooth out bad timestamps
            '-i', inputPath,
            '-map', '0',
            '-c:v', settings?.codec || 'libx265',
            '-preset', settings?.preset || 'medium',
            '-crf', (settings?.crf ?? 18).toString(),
            ...(settings?.isAnimated ? ['-tune', 'animation'] : []),
            '-pix_fmt', 'yuv420p',
            '-c:a', 'aac',
            '-b:a', '192k',
            '-c:s', 'copy',
            '-disposition:s', '0' // Remove default/forced flags from subtitles
        ];

        // Video Filters
        const vf: string[] = [];
        if (settings?.deinterlace) {
            vf.push('yadif');
        }
        if (settings?.crop) {
            vf.push(`crop=${settings.crop}`);
        }

        if (vf.length > 0) {
            args.push('-vf', vf.join(','));
        }

        args.push(outputPath);

        const child = spawn('ffmpeg', args, {
            stdio: ['ignore', 'ignore', 'pipe'] // Ignore stdin/stdout to prevent blocking
        });

        let stderrTail = '';
        const maxTail = 5000;

        child.stderr.on('data', (data) => {
            const chunk = data.toString();
            // Maintain a limited tail for error reporting
            stderrTail = (stderrTail + chunk).slice(-maxTail);

            // Parse progress from the chunk
            const timeMatch = chunk.match(/time=(\d{2}:\d{2}:\d{2}\.\d{2})/);
            const fpsMatch = chunk.match(/fps=\s*([\d.]+)/);
            const speedMatch = chunk.match(/speed=\s*([\d.]+x)/);

            if (timeMatch) {
                const timeStr = timeMatch[1];
                let percentage: number | undefined = undefined;

                if (totalDurationSeconds && totalDurationSeconds > 0) {
                    const parts = timeStr.split(':').map(Number);
                    const seconds = parts[0] * 3600 + parts[1] * 60 + parts[2];
                    percentage = Math.min(100, (seconds / totalDurationSeconds) * 100);
                }

                onProgress?.({
                    time: timeStr,
                    fps: fpsMatch ? parseFloat(fpsMatch[1]) : undefined,
                    speed: speedMatch?.[1],
                    percentage
                });
            }
        });

        child.on('close', (code) => {
            if (code === 0) {
                resolve(ok(undefined));
            } else {
                resolve(err(new Error(`ffmpeg exited with code ${code}. Stderr tail: ${stderrTail}`)));
            }
        });

        child.on('error', (error) => {
            resolve(err(error));
        });
    });
};

export const detectCrop = (inputPath: string): Promise<Result<string | null, Error>> => {
    return new Promise((resolve) => {
        // Run cropdetect for 30 seconds to find the best crop
        const args = [
            '-i', inputPath,
            '-vf', 'cropdetect=24:16:0', // 24/16 round to block sizes, 0 limit
            '-t', '30',
            '-f', 'null',
            '-'
        ];

        const child = spawn('ffmpeg', args);
        let stderr = '';

        child.stderr.on('data', (data) => {
            stderr += data.toString();
        });

        child.on('close', (code) => {
            if (code === 0) {
                // Parse stderr for crop=w:h:x:y
                const matches = stderr.matchAll(/crop=(\d+:\d+:\d+:\d+)/g);
                const counts: Record<string, number> = {};
                let maxCount = 0;
                let bestCrop = null;

                for (const match of matches) {
                    const crop = match[1];
                    counts[crop] = (counts[crop] || 0) + 1;
                    if (counts[crop] > maxCount) {
                        maxCount = counts[crop];
                        bestCrop = crop;
                    }
                }
                resolve(ok(bestCrop));
            } else {
                resolve(err(new Error(`ffmpeg detectCrop failed: ${stderr.substring(stderr.length - 500)}`)));
            }
        });

        child.on('error', (errObj) => {
            resolve(err(errObj));
        });
    });
}

export const ffmpeg = {
    transcode,
    detectCrop
};
