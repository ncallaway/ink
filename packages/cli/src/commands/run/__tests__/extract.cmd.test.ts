import { describe, it, expect, mock, beforeEach } from "bun:test";
import { Command } from "commander";
import { ok } from "neverthrow";
import { createMockPlan } from "../../__tests__/fixtures";

const mockFs = {
    readdir: mock(() => Promise.resolve([])),
    readFile: mock(() => Promise.resolve("")),
    writeFile: mock(() => Promise.resolve()),
    access: mock(() => Promise.resolve()),
    mkdir: mock(() => Promise.resolve()),
    rm: mock(() => Promise.resolve()),
    rename: mock(() => Promise.resolve()),
};

const mockLib = {
    drive: {
        list: mock(() => ok(["/dev/sr0"])),
        status: mock(() => ok(4)), // DISK_PRESENT
    },
    disc: {
        identify: mock(() => Promise.resolve(ok("disc123"))),
    },
    makemkv: {
        findDriveIndex: mock(() => Promise.resolve(ok(0))),
        extractTitle: mock(() => Promise.resolve(ok(undefined))),
    }
};

mock.module("fs/promises", () => mockFs);
mock.module("node:fs/promises", () => mockFs);
mock.module("@ink/shared", () => ({
    lib: mockLib,
    DriveStatus: { DISK_PRESENT: 4 }
}));
mock.module("os", () => ({ homedir: () => "/tmp/fake-home" }));
mock.module("node:os", () => ({ homedir: () => "/tmp/fake-home" }));

// Mock sibling/parent modules
mock.module("../../plan/utils", () => ({
    loadPlan: mock((id: string) => Promise.resolve(createMockPlan({ discId: id })))
}));

// We need to mock the entire utils.ts in the same directory because it's imported by extract.ts
mock.module("../utils", () => ({
    ensureDirs: mock(() => Promise.resolve()),
    getExtractedDir: mock(() => "/tmp/extracted"),
    getExtractedPath: mock(() => "/tmp/extracted/t01.mkv"),
    getExtractedStatusPath: mock(() => "/tmp/extracted/t01.json"),
    hasStatus: mock(() => Promise.resolve(false)),
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

import { runExtract } from "../extract";

describe("run extract command", () => {
    beforeEach(() => {
        mockFs.access.mockClear();
        mockFs.readdir.mockClear();
        mockFs.readFile.mockClear();
        mockLib.makemkv.extractTitle.mockClear();
    });

    it("should extract tracks for a planned disc", async () => {
        mockFs.readdir.mockResolvedValue(["some-file.mkv"]);

        const program = new Command();
        program.exitOverride();
        runExtract(program);
        
        await program.parseAsync(["node", "ink", "extract"]);

        expect(mockLib.makemkv.extractTitle).toHaveBeenCalled();
    });
});
