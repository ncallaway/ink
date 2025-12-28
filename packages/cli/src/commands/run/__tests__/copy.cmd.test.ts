import { describe, it, expect, mock, beforeEach } from "bun:test";
import { Command } from "commander";
import { createMockPlan } from "../../__tests__/fixtures";

const mockFs = {
    readdir: mock(() => Promise.resolve(["disc123"])),
    readFile: mock(() => Promise.resolve("")),
    writeFile: mock(() => Promise.resolve()),
    access: mock(() => Promise.resolve()),
};

const mockExecAsync = mock(() => Promise.resolve({ stdout: "", stderr: "" }));

mock.module("fs/promises", () => mockFs);
mock.module("node:fs/promises", () => mockFs);

// Mock child_process and util.promisify to return our direct mockExecAsync
mock.module("child_process", () => ({
    exec: mock(() => {}) // Not used because we mock promisify
}));

mock.module("util", () => ({
    promisify: () => mockExecAsync
}));

mock.module("os", () => ({ homedir: () => "/tmp/fake-home" }));
mock.module("node:os", () => ({ homedir: () => "/tmp/fake-home" }));

mock.module("../../plan/utils", () => ({
    loadPlan: mock((id: string) => Promise.resolve(createMockPlan({ discId: id, type: 'movie' })))
}));

mock.module("../utils", () => ({
    getStagingDir: mock(() => "/tmp/staging"),
    getEncodedPath: mock(() => "/tmp/encoded/t01.mkv"),
    getEncodedStatusPath: mock(() => "/tmp/encoded/t01.json"),
    getReviewedStatusPath: mock(() => "/tmp/reviewed/t01.json"),
    getCopiedStatusPath: mock(() => "/tmp/copied/t01.json"),
    hasStatus: mock((path: string) => {
        if (path.includes("encoded/t01.json")) return Promise.resolve(true);
        return Promise.resolve(false);
    }),
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

import { runCopy } from "../copy";

describe("run copy command", () => {
    beforeEach(() => {
        mockFs.readdir.mockClear();
        mockExecAsync.mockClear();
        process.env.SMB_TARGET = "smb://host/share/path";
    });

    it("should copy encoded tracks", async () => {
        const program = new Command();
        program.exitOverride();
        runCopy(program);
        
        await program.parseAsync(["node", "ink", "copy"]);

        expect(mockExecAsync).toHaveBeenCalled();
    });
});
