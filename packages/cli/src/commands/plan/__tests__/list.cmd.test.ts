import { describe, it, expect, mock, beforeEach } from "bun:test";
import { Command } from "commander";
import { createMockPlan } from "../../__tests__/fixtures";

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

import { planList } from "../list";

describe("plan list command", () => {
    beforeEach(() => {
        mockFs.readdir.mockClear();
        mockFs.readFile.mockClear();
        mockFs.access.mockClear();
    });

    it("should list available plans", async () => {
        mockFs.readdir.mockResolvedValue(["plan1.json"]);
        mockFs.readFile.mockResolvedValue(JSON.stringify(createMockPlan({ discId: "plan1" })));
        mockFs.access.mockResolvedValue(undefined);

        const program = new Command();
        program.exitOverride();
        planList(program);
        
        await program.parseAsync(["node", "ink", "list"]);

        expect(mockFs.readdir).toHaveBeenCalled();
        expect(mockFs.readFile).toHaveBeenCalled();
    });
});
