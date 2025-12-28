import { describe, it, expect, mock, beforeEach } from "bun:test";
import { Command } from "commander";
import { createMockPlan } from "../../__tests__/fixtures";

const mockFs = {
    readFile: mock(),
    access: mock(),
};

mock.module("fs/promises", () => mockFs);
mock.module("node:fs/promises", () => mockFs);
mock.module("os", () => ({ homedir: () => "/tmp/fake-home" }));
mock.module("node:os", () => ({ homedir: () => "/tmp/fake-home" }));

mock.module("../../run/utils", () => ({
    getTrackStatus: mock(() => Promise.resolve("pending")),
    getReviewedStatusPath: mock(() => "/tmp/fake-reviewed"),
    hasStatus: mock(() => Promise.resolve(false))
}));

import { planShow } from "../show";

describe("plan show command", () => {
    beforeEach(() => {
        mockFs.readFile.mockClear();
        mockFs.access.mockClear();
    });

    it("should display a plan for a given disc id", async () => {
        mockFs.readFile.mockResolvedValue(JSON.stringify(createMockPlan()));
        mockFs.access.mockResolvedValue(undefined);

        const program = new Command();
        program.exitOverride();
        planShow(program);
        
        await program.parseAsync(["node", "ink", "show", "disc123"]);

        expect(mockFs.readFile).toHaveBeenCalled();
    });
});
