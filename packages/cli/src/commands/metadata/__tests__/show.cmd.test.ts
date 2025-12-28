import { describe, it, expect, mock, beforeEach } from "bun:test";
import { Command } from "commander";
import { createMockMetadata } from "../../__tests__/fixtures";

const mockFs = {
    readFile: mock(),
    access: mock(),
};

mock.module("fs/promises", () => mockFs);
mock.module("node:fs/promises", () => mockFs);
mock.module("os", () => ({ homedir: () => "/tmp/fake-home" }));
mock.module("node:os", () => ({ homedir: () => "/tmp/fake-home" }));

import { metadataShow } from "../show";

describe("metadata show command", () => {
    beforeEach(() => {
        mockFs.readFile.mockClear();
        mockFs.access.mockClear();
    });

    it("should display metadata for a given disc id", async () => {
        mockFs.readFile.mockResolvedValue(JSON.stringify(createMockMetadata()));
        mockFs.access.mockResolvedValue(undefined);

        const program = new Command();
        program.exitOverride();
        metadataShow(program);
        
        await program.parseAsync(["node", "ink", "show", "disc123"]);

        expect(mockFs.readFile).toHaveBeenCalled();
    });
});
