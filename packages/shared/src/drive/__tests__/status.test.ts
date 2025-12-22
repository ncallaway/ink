import { describe, expect, test } from "bun:test";
import { detectTray, DriveStatus } from "../status";
import { platform } from "os";

describe("detectTray", () => {
  test("should return an error for non-existent device", () => {
    if (platform() === 'linux') {
        const result = detectTray("/dev/non_existent_device_12345");
        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr().message).toContain("ENOENT");
    } else {
        // On other platforms it returns "Not implemented" error immediately
        const result = detectTray("/dev/null");
        expect(result.isErr()).toBe(true);
    }
  });

  test("should return not implemented on non-supported platforms (if applicable)", () => {
    if (platform() !== 'linux') {
        const result = detectTray("/dev/cdrom");
        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr().message).toContain("not yet implemented");
    }
  });
});
