import { describe, it, expect, spyOn, beforeAll, afterAll } from "bun:test";
import { detect } from "../detect";
import { makemkv } from "../../makemkv";

describe("detect", () => {
  const originalDriveScan = makemkv.driveScan;

  afterAll(() => {
    makemkv.driveScan = originalDriveScan;
  });

  it("should detect a disc when makemkv returns valid drive info", async () => {
    const mockOutput = `MSG:1005,0,1,"MakeMKV v1.17.8 linux(x64-release) started","%1 started","MakeMKV v1.17.8 linux(x64-release)"
MSG:5075,131072,2,"The new version 1.18.2 is available for download at http://www.makemkv.com/download/","The new version %1 is available for download at %2","1.18.2","http://www.makemkv.com/download/"
DRV:0,2,999,1,"BD-RE PIONEER BD-RW   BDR-XD07 1.03 AFDL029347UC","Bluey - Season 3 - Second Half","/dev/sr0"
DRV:1,256,999,0,"","",""
DRV:2,256,999,0,"","",""
DRV:3,256,999,0,"","",""
DRV:4,256,999,0,"","",""
DRV:5,256,999,0,"","",""
DRV:6,256,999,0,"","",""
DRV:7,256,999,0,"","",""
DRV:8,256,999,0,"","",""
DRV:9,256,999,0,"","",""
DRV:10,256,999,0,"","",""
DRV:11,256,999,0,"","",""
DRV:12,256,999,0,"","",""
DRV:13,256,999,0,"","",""
DRV:14,256,999,0,"","",""
DRV:15,256,999,0,"","",""
MSG:5010,0,0,"Failed to open disc","Failed to open disc"
TCOUNT:0`;

    spyOn(makemkv, "driveScan").mockResolvedValue({ stdout: mockOutput, stderr: "" });

    const result = await detect();

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toBe("/dev/sr0");
    }
  });

  it("should return an error when a drive is present, but no disc is detected", async () => {
    const mockOutput = `makemkv stdout MSG:1005,0,1,"MakeMKV v1.17.8 linux(x64-release) started","%1 started","MakeMKV v1.17.8 linux(x64-release)"
MSG:5075,131072,2,"The new version 1.18.2 is available for download at http://www.makemkv.com/download/","The new version %1 is available for download at %2","1.18.2","http://www.makemkv.com/download/"
DRV:0,3,999,0,"BD-RE PIONEER BD-RW   BDR-XD07 1.03 AFDL029347UC","","/dev/sr0"
DRV:1,256,999,0,"","",""
DRV:2,256,999,0,"","",""
DRV:3,256,999,0,"","",""
DRV:4,256,999,0,"","",""
DRV:5,256,999,0,"","",""
DRV:6,256,999,0,"","",""
DRV:7,256,999,0,"","",""
DRV:8,256,999,0,"","",""
DRV:9,256,999,0,"","",""
DRV:10,256,999,0,"","",""
DRV:11,256,999,0,"","",""
DRV:12,256,999,0,"","",""
DRV:13,256,999,0,"","",""
DRV:14,256,999,0,"","",""
DRV:15,256,999,0,"","",""
MSG:5010,0,0,"Failed to open disc","Failed to open disc"
TCOUNT:0
`;
    spyOn(makemkv, "driveScan").mockResolvedValue({ stdout: mockOutput, stderr: "" });

    const result = await detect();
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toBe("No disc was detected");
    }
  });

  it("should return an error when no drive is present", async () => {
    const mockOutput = `makemkv stdout MSG:1005,0,1,"MakeMKV v1.17.8 linux(x64-release) started","%1 started","MakeMKV v1.17.8 linux(x64-release)"
MSG:5075,131072,2,"The new version 1.18.2 is available for download at http://www.makemkv.com/download/","The new version %1 is available for download at %2","1.18.2","http://www.makemkv.com/download/"
MSG:5042,0,0,"The program can't find any usable optical drives.","The program can't find any usable optical drives."
DRV:0,256,999,0,"","",""
DRV:1,256,999,0,"","",""
DRV:2,256,999,0,"","",""
DRV:3,256,999,0,"","",""
DRV:4,256,999,0,"","",""
DRV:5,256,999,0,"","",""
DRV:6,256,999,0,"","",""
DRV:7,256,999,0,"","",""
DRV:8,256,999,0,"","",""
DRV:9,256,999,0,"","",""
DRV:10,256,999,0,"","",""
DRV:11,256,999,0,"","",""
DRV:12,256,999,0,"","",""
DRV:13,256,999,0,"","",""
DRV:14,256,999,0,"","",""
DRV:15,256,999,0,"","",""
MSG:5010,0,0,"Failed to open disc","Failed to open disc"
TCOUNT:0`;
    spyOn(makemkv, "driveScan").mockResolvedValue({ stdout: mockOutput, stderr: "" });

    const result = await detect();
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toBe("No disc was detected");
    }
  });
});
