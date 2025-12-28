import { describe, it, expect, mock, beforeEach } from "bun:test";
import { Command } from "commander";
import { createMockMetadata } from "../../__tests__/fixtures";
import { mockPrompts } from "../../__tests__/promptMock";

const mockFs = {
    readdir: mock(),
    readFile: mock(),
    writeFile: mock(),
    access: mock(),
    mkdir: mock(() => Promise.resolve()),
};

mock.module("fs/promises", () => mockFs);
mock.module("node:fs/promises", () => mockFs);
mock.module("os", () => ({ homedir: () => "/tmp/fake-home" }));
mock.module("node:os", () => ({ homedir: () => "/tmp/fake-home" }));

import { planCreate } from "../create";

describe("plan create command", () => {
    beforeEach(() => {
        mockFs.readdir.mockClear();
        mockFs.readFile.mockClear();
        mockFs.writeFile.mockClear();
        mockFs.access.mockClear();

        mockPrompts.select.mockImplementation((opts: any) => {
            if (opts.message.includes("Select a disc")) return Promise.resolve(createMockMetadata());
            if (opts.message.includes("type of content")) return Promise.resolve("movie");
            if (opts.message.includes("match")) return Promise.resolve({ title: "Mock Movie", year: 2020, id: "tt123" });
            if (opts.message.includes("cut-off")) return Promise.resolve(0);
            if (opts.message.includes("look correct")) return Promise.resolve("finalize");
            return Promise.resolve(null);
        });
        mockPrompts.input.mockImplementation((opts: any) => Promise.resolve(opts.default || "mock-input"));
        mockPrompts.checkbox.mockImplementation((opts: any) => Promise.resolve(opts.choices.map((c: any) => c.value)));
    });

    it("should create a movie plan", async () => {
        mockFs.readdir.mockResolvedValue(["disc123.json"]);
        mockFs.readFile.mockResolvedValue(JSON.stringify(createMockMetadata()));
        mockFs.access.mockRejectedValue(new Error("ENOENT")); // Plan doesn't exist
        mockFs.writeFile.mockResolvedValue(undefined);

        const program = new Command();
        program.exitOverride();
        planCreate(program);
        
        await program.parseAsync(["node", "ink", "create"]);

        expect(mockFs.writeFile).toHaveBeenCalled();
    });
});
