import { DiscMetadata, BackupPlan } from "@ink/shared";

export const createMockMetadata = (overrides: Partial<DiscMetadata> = {}): DiscMetadata => ({
    discId: "disc123",
    volumeLabel: "TEST_VOL",
    userProvidedName: "Test Disc",
    scannedAt: new Date().toISOString(),
    tracks: [
        {
            trackNumber: 1,
            duration: "0:30:00",
            size: 1000000,
            video: { width: 1920, height: 1080, codec: "h264", framerate: 23.976 },
            audio: [],
            subtitles: [],
            chapters: 10,
            title: "Track 1"
        }
    ],
    ...overrides
});

export const createMockPlan = (overrides: Partial<BackupPlan> = {}): BackupPlan => ({
    discId: "disc123",
    discLabel: "Test Disc Label",
    title: "Test Plan Title",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: 'pending',
    type: 'movie',
    tracks: [
        {
            trackNumber: 1,
            name: "Track 1",
            extract: true,
            output: {
                filename: "Track 1",
                directory: "movies/"
            }
        }
    ],
    ...overrides
});
