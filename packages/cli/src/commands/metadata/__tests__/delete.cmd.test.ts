import { describe, it, expect, mock, beforeEach } from "bun:test";
import { Command } from "commander";
import { mockPrompts } from "../../__tests__/promptMock";

const mockFs = {
    unlink: mock(),
    access: mock(),
};

mock.module("fs/promises", () => mockFs);
mock.module("node:fs/promises", () => mockFs);
mock.module("os", () => ({ homedir: () => "/tmp/fake-home" }));
mock.module("node:os", () => ({ homedir: () => "/tmp/fake-home" }));

import { metadataDelete } from "../delete";

describe("metadata delete command", () => {
    beforeEach(() => {
        mockFs.unlink.mockClear();
        mockFs.access.mockClear();
        mockPrompts.confirm.mockResolvedValue(true);
    });

    it("should delete metadata for a given disc id", async () => {
        mockFs.access.mockResolvedValue(undefined);
        mockFs.unlink.mockResolvedValue(undefined);

        const program = new Command();
        program.exitOverride();
        metadataDelete(program);
        
        await program.parseAsync(["node", "ink", "delete", "disc123"]);

        expect(mockFs.unlink).toHaveBeenCalled();
    });
});
