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
            '-i', inputPath,
            '-map', '0',
            '-c:v', settings?.codec || 'libx265',
            '-preset', settings?.preset || 'slow',
            '-crf', (settings?.crf ?? 22).toString(),
            '-c:a', 'aac',
            '-b:a', '192k',
            '-c:s', 'copy',
            outputPath
        ];

        const child = spawn('ffmpeg', args);

        let stderr = '';

        child.stderr.on('data', (data) => {
            const output = data.toString();
            stderr += output;

            // frame=  235 fps= 42 q=-0.0 size=    1024kB time=00:00:10.43 bitrate= 803.1kbits/s speed=1.86x
            const timeMatch = output.match(/time=(\d{2}:\d{2}:\d{2}\.\d{2})/);
            const fpsMatch = output.match(/fps=\s*([\d.]+)/);
            const speedMatch = output.match(/speed=\s*([\d.]+x)/);

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
                resolve(err(new Error(`ffmpeg exited with code ${code}. Stderr: ${stderr.substring(stderr.length - 500)}`)));
            }
        });

        child.on('error', (error) => {
            resolve(err(error));
        });
    });
};

export const ffmpeg = {
    transcode
};
