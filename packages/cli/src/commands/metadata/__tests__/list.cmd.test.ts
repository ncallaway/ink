import { describe, it, expect, mock, beforeEach } from "bun:test";
import { Command } from "commander";

const mockFs = {
    readdir: mock(),
    readFile: mock(),
    access: mock(),
};

mock.module("fs/promises", () => mockFs);
mock.module("node:fs/promises", () => mockFs);
mock.module("os", () => ({ homedir: () => "/tmp/fake-home" }));
mock.module("node:os", () => ({ homedir: () => "/tmp/fake-home" }));

// Mock dynamic imports or complex dependencies
mock.module("../../run/utils", () => ({
    getTrackStatus: mock(() => Promise.resolve("pending")),
    getReviewedStatusPath: mock(() => "/tmp/fake-reviewed"),
    hasStatus: mock(() => Promise.resolve(false))
}));

import { metadataList } from "../list";
import { createMockMetadata } from "../../__tests__/fixtures";

describe("metadata list command", () => {
    beforeEach(() => {
        mockFs.readdir.mockClear();
        mockFs.readFile.mockClear();
        mockFs.access.mockClear();
    });

    it("should list available metadata", async () => {
        mockFs.readdir.mockResolvedValue(["disc1.json"]);
        mockFs.readFile.mockResolvedValue(JSON.stringify(createMockMetadata({ discId: "disc1" })));
        mockFs.access.mockResolvedValue(undefined); // Path exists

        const program = new Command();
        program.exitOverride();
        metadataList(program);
        
        // We don't strictly test output, just that it didn't crash and read files
        await program.parseAsync(["node", "ink", "list"]);

        expect(mockFs.readdir).toHaveBeenCalled();
        expect(mockFs.readFile).toHaveBeenCalled();
    });

    it("should handle empty metadata directory", async () => {
        mockFs.readdir.mockResolvedValue([]);
        
        const program = new Command();
        program.exitOverride();
        metadataList(program);
        
        await program.parseAsync(["node", "ink", "list"]);
        expect(mockFs.readdir).toHaveBeenCalled();
    });
});
