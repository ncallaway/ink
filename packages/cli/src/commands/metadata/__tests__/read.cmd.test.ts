import { describe, it, expect, mock, beforeEach } from "bun:test";

const mockExec = mock();
const mockFs = {
    access: mock(),
    writeFile: mock(),
    readFile: mock(),
    mkdir: mock(() => Promise.resolve()),
};
const mockIdentifyDisc = mock();

// Mock factories
const cpMock = {
    exec: (cmd: string, opts: any, cb: any) => {
        const callback = typeof opts === 'function' ? opts : cb;
        const res = mockExec(cmd);
        if (res instanceof Promise) {
            res.then(out => callback(null, { stdout: String(out), stderr: "" }))
               .catch(err => callback(err, { stdout: "", stderr: "" }));
        } else {
            setImmediate(() => callback(null, { stdout: String(res), stderr: "" }));
        }
        return { unref: () => {}, kill: () => {} };
    }
};

const sharedMock = {
    identifyDisc: (...args: any[]) => mockIdentifyDisc(...args),
};

// Apply mocks
mock.module("child_process", () => cpMock);
mock.module("fs/promises", () => mockFs);
mock.module("@ink/shared", () => sharedMock);
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

describe("metadata read command", () => {
    beforeEach(() => {
        mockExec.mockClear();
        mockFs.access.mockClear();
        mockFs.writeFile.mockClear();
        mockFs.readFile.mockClear();
        mockIdentifyDisc.mockClear();
        
        mockExec.mockImplementation(() => "");
        mockFs.access.mockImplementation(() => Promise.reject(new Error("ENOENT")));
        mockFs.writeFile.mockImplementation(() => Promise.resolve());
        mockFs.readFile.mockImplementation(() => Promise.resolve(""));
    });

    it("should perform a full scan when cache is missing", async () => {
        const { metadataRead } = await import("../read");
        const { Command } = await import("commander");
        const { ok } = await import("neverthrow");

        mockIdentifyDisc.mockImplementation(() => Promise.resolve(ok("test-id")));
        mockExec.mockImplementation((cmd: string) => {
            if (cmd.includes("info disc:9999")) return "DRV:0,2,999,1,\"BD-RE\",\"Bluey\",\"/dev/sr0\"";
            if (cmd.includes("info dev:/dev/sr0")) return "CINFO:2,0,\"Bluey\"\nTINFO:0,9,0,\"0:07:20\"";
            return "";
        });

        const program = new Command();
        program.exitOverride();
        program.configureOutput({ writeOut: () => {}, writeErr: () => {} });
        metadataRead(program);
        
        await program.parseAsync(["node", "ink", "read"]);

        expect(mockIdentifyDisc).toHaveBeenCalled();
        expect(mockExec).toHaveBeenCalled();
        expect(mockFs.writeFile).toHaveBeenCalled();
    });

    it("should skip scan when cache exists", async () => {
        const { metadataRead } = await import("../read");
        const { Command } = await import("commander");
        const { ok } = await import("neverthrow");

        mockIdentifyDisc.mockImplementation(() => Promise.resolve(ok("test-id")));
        mockExec.mockImplementation((cmd: string) => {
            if (cmd.includes("info disc:9999")) return "DRV:0,2,999,1,\"BD-RE\",\"Bluey\",\"/dev/sr0\"";
            return "";
        });
        
        mockFs.access.mockImplementation(() => Promise.resolve(undefined));
        mockFs.readFile.mockImplementation(() => Promise.resolve(JSON.stringify({
            discId: "test-id",
            volumeLabel: "Cached",
            tracks: []
        })));

        const program = new Command();
        program.exitOverride();
        program.configureOutput({ writeOut: () => {}, writeErr: () => {} });
        metadataRead(program);
        
        await program.parseAsync(["node", "ink", "read"]);

        expect(mockFs.readFile).toHaveBeenCalled();
        const calls = mockExec.mock.calls.map(c => c[0]);
        expect(calls.some(c => c.includes("dev:/dev/sr0"))).toBe(false);
    });
});
