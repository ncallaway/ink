import { describe, expect, test } from "bun:test";
import { status } from "../status";
import { platform } from "os";

describe("status", () => {
  test("should return an error for non-existent device", () => {
    if (platform() === 'linux') {
        const result = status("/dev/non_existent_device_12345");
        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr().message).toContain("ENOENT");
    } else {
        // On other platforms it returns "Not implemented" error immediately
        const result = status("/dev/null");
        expect(result.isErr()).toBe(true);
    }
  });

  test("should return not implemented on non-supported platforms (if applicable)", () => {
    if (platform() !== 'linux') {
        const result = status("/dev/cdrom");
        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr().message).toContain("not yet implemented");
    }
  });
});
