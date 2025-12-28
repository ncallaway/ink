import { describe, it, expect, mock, beforeEach } from "bun:test";
import { Command } from "commander";
import { ok } from "neverthrow";
import { createMockPlan, createMockMetadata } from "../../__tests__/fixtures";

const mockFs = {
    readdir: mock(() => Promise.resolve([])),
    readFile: mock(() => Promise.resolve("")),
    writeFile: mock(() => Promise.resolve()),
    access: mock(() => Promise.resolve()),
};

const mockLib = {
    ffmpeg: {
        detectCrop: mock(() => Promise.resolve(ok("0:0:0:0"))),
        transcode: mock(() => Promise.resolve(ok(undefined))),
    }
};

mock.module("fs/promises", () => mockFs);
mock.module("node:fs/promises", () => mockFs);
mock.module("@ink/shared", () => ({
    lib: mockLib
}));
mock.module("os", () => ({ homedir: () => "/tmp/fake-home" }));
mock.module("node:os", () => ({ homedir: () => "/tmp/fake-home" }));

mock.module("../../plan/utils", () => ({
    loadPlan: mock((id: string) => Promise.resolve(createMockPlan({ discId: id })))
}));

mock.module("../../metadata/utils", () => ({
    loadMetadata: mock((id: string) => Promise.resolve(createMockMetadata({ discId: id })))
}));

mock.module("../utils", () => ({
    ensureDirs: mock(() => Promise.resolve()),
    getStagingDir: mock(() => "/tmp/staging"),
    getExtractedPath: mock(() => "/tmp/extracted/t01.mkv"),
    getEncodedPath: mock(() => "/tmp/encoded/t01.mkv"),
    getExtractedStatusPath: mock(() => "/tmp/extracted/t01.json"),
    getEncodedStatusPath: mock(() => "/tmp/encoded/t01.json"),
    hasStatus: mock((path: string) => Promise.resolve(path.includes("extracted/t01.json"))), // Only extracted exists
    writeStatus: mock(() => Promise.resolve()),
}));

mock.module("ora", () => ({
    default: () => ({
        start: function() { return this; },
        stop: function() { return this; },
        succeed: function() { return this; },
        fail: function() { return this; },
        warn: function() { return this; },
        info: function() { return this; },
        text: ""
    })
}));

import { runTranscode } from "../transcode";

describe("run transcode command", () => {
    beforeEach(() => {
        mockFs.readdir.mockClear();
        mockLib.ffmpeg.transcode.mockClear();
    });

    it("should transcode tracks that are extracted but not encoded", async () => {
        mockFs.readdir.mockResolvedValue(["disc123"]);

        const program = new Command();
        program.exitOverride();
        runTranscode(program);
        
        await program.parseAsync(["node", "ink", "transcode"]);

        expect(mockLib.ffmpeg.transcode).toHaveBeenCalled();
    });
});
