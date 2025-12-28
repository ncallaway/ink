import { describe, it, expect, mock, beforeEach } from "bun:test";
import { Command } from "commander";
import { ok } from "neverthrow";
import { createMockMetadata } from "../../__tests__/fixtures";

const mockFs = {
    access: mock(),
    writeFile: mock(),
    readFile: mock(),
    mkdir: mock(() => Promise.resolve()),
};

const mockLib = {
    drive: {
        list: mock(() => ok(["/dev/sr0"])),
        status: mock(() => ok(4)), // DISK_PRESENT
    },
    disc: {
        identify: mock(() => Promise.resolve(ok("test-disc-id"))),
    },
    makemkv: {
        findDriveIndex: mock(() => Promise.resolve(ok(0))),
        runInfo: mock((_idx: number, cb?: any) => {
            if (cb) cb({ message: "Mocking...", percentage: 50 });
            return Promise.resolve(`CINFO:32,0,"TEST_VOL"
TINFO:0,9,0,"0:30:00"
TINFO:0,11,0,"1000000"
`);
        }),
        parseCsvLine: mock((line: string) => line.split(',').map(s => s.replace(/"/g, '')))
    }
};

mock.module("fs/promises", () => mockFs);
mock.module("node:fs/promises", () => mockFs);
mock.module("@ink/shared", () => ({
    lib: mockLib
}));
mock.module("os", () => ({ homedir: () => "/tmp/fake-home" }));
mock.module("node:os", () => ({ homedir: () => "/tmp/fake-home" }));
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

// Mock readline
mock.module("node:readline", () => ({
    createInterface: () => ({
        question: (_q: string, cb: (a: string) => void) => cb("Test Name"),
        close: () => {}
    })
}));

import { metadataRead } from "../read";

describe("metadata read command", () => {
    beforeEach(() => {
        mockFs.access.mockClear();
        mockFs.writeFile.mockClear();
        mockFs.readFile.mockClear();
        mockLib.disc.identify.mockClear();
        mockLib.makemkv.runInfo.mockClear();
    });

    it("should perform a full scan when cache is missing", async () => {
        mockFs.access.mockRejectedValue(new Error("ENOENT"));
        
        const program = new Command();
        program.exitOverride();
        metadataRead(program);
        
        await program.parseAsync(["node", "ink", "read"]);

        expect(mockLib.disc.identify).toHaveBeenCalled();
        expect(mockLib.makemkv.runInfo).toHaveBeenCalled();
        expect(mockFs.writeFile).toHaveBeenCalled();
    });

    it("should skip scan when cache exists", async () => {
        mockFs.access.mockResolvedValue(undefined);
        mockFs.readFile.mockResolvedValue(JSON.stringify(createMockMetadata({ discId: "test-disc-id" })));

        const program = new Command();
        program.exitOverride();
        metadataRead(program);
        
        await program.parseAsync(["node", "ink", "read"]);

        expect(mockFs.readFile).toHaveBeenCalled();
        expect(mockLib.makemkv.runInfo).not.toHaveBeenCalled();
    });
});
