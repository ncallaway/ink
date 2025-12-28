import { describe, it, expect, mock, beforeEach } from "bun:test";
import { Command } from "commander";
import { createMockPlan } from "../../__tests__/fixtures";
import { mockPrompts } from "../../__tests__/promptMock";

const mockFs = {
    readdir: mock(() => Promise.resolve([])),
    readFile: mock(() => Promise.resolve("")),
    writeFile: mock(() => Promise.resolve()),
    access: mock(() => Promise.resolve()),
};

mock.module("fs/promises", () => mockFs);
mock.module("node:fs/promises", () => mockFs);
mock.module("os", () => ({ homedir: () => "/tmp/fake-home" }));
mock.module("node:os", () => ({ homedir: () => "/tmp/fake-home" }));

mock.module("../../plan/utils", () => ({
    loadPlan: mock((id: string) => Promise.resolve(createMockPlan({ 
        discId: id, 
        type: 'tv',
        candidates: [{ id: 1, name: "Episode 1", season: 1, number: 1 }]
    }))),
    savePlan: mock(() => Promise.resolve()),
}));

mock.module("../utils", () => ({
    ensureDirs: mock(() => Promise.resolve()),
    getStagingDir: mock(() => "/tmp/staging"),
    getExtractedPath: mock(() => "/tmp/extracted/t01.mkv"),
    getEncodedPath: mock(() => "/tmp/encoded/t01.mkv"),
    getExtractedStatusPath: mock(() => "/tmp/extracted/t01.json"),
    getReviewedStatusPath: mock(() => "/tmp/reviewed/t01.json"),
    hasStatus: mock((path: string) => Promise.resolve(path.includes("extracted/t01.json"))),
    writeStatus: mock(() => Promise.resolve()),
}));

// Mock VLC spawn
mock.module("child_process", () => ({
    spawn: mock(() => ({
        on: mock(),
        kill: mock(),
    }))
}));

import { runReview } from "../review";

describe("run review command", () => {
    beforeEach(() => {
        mockFs.readdir.mockClear();
        mockPrompts.select.mockResolvedValue(1);
    });

    it("should process TV plans ready for review", async () => {
        mockFs.readdir.mockResolvedValue(["disc123"]);

        const program = new Command();
        program.exitOverride();
        runReview(program);
        
        await program.parseAsync(["node", "ink", "review"]);

        expect(mockFs.readdir).toHaveBeenCalled();
    });
});
