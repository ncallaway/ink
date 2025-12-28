import { describe, expect, test, mock } from "bun:test";
import { list as listDrives } from "../list";
import { platform } from "os";

// Mocking fs.readdirSync for Linux tests
// Note: Bun's test runner can't easily mock native modules like 'node:fs' globally 
// without module loader hooks or similar. 
// However, since we are in a real environment, we can rely on integration-style testing 
// or simple behavior verification.

describe("listDrives", () => {
  test("should return a Result", () => {
    const result = listDrives();
    expect(result).toBeDefined();
    if (platform() === 'linux') {
      expect(result.isOk()).toBe(true);
      const drives = result._unsafeUnwrap();
      expect(Array.isArray(drives)).toBe(true);
      // On this machine we might not have drives, but it should be an array
      drives.forEach(drive => {
        expect(drive).toStartWith('/dev/sr');
      });
    } else {
      expect(result.isErr()).toBe(true);
    }
  });
});
