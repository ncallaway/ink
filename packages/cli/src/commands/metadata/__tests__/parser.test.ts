import { describe, it, expect } from "bun:test";
import { parseMakeMkvOutput } from "../read";

const RAW_OUTPUT = `MSG:1005,0,1,"MakeMKV v1.17.8 linux(x64-release) started","%1 started","MakeMKV v1.17.8 linux(x64-release)"
MSG:5075,131072,2,"The new version 1.18.2 is available for download at http://www.makemkv.com/download/","The new version %1 is available for download at %2","1.18.2","http://www.makemkv.com/download/"
DRV:0,2,999,1,"BD-RE PIONEER BD-RW   BDR-XD07 1.03 AFDL029347UC","Bluey - Season 3 - Second Half","/dev/sr0"
TCOUNT:25
CINFO:1,6206,"DVD disc"
CINFO:2,0,"Bluey - Season 3 - Second Half"
CINFO:30,0,"Bluey - Season 3 - Second Half"
CINFO:32,0,"Bluey - Season 3 - Second Half"
TINFO:0,8,0,"30"
TINFO:0,9,0,"3:19:55"
TINFO:0,10,0,"7.3 GB"
TINFO:0,11,0,"7852398592"
TINFO:0,27,0,"00.mkv"
SINFO:0,0,1,6201,"Video"
SINFO:0,0,5,0,"V_MPEG2"
SINFO:0,0,19,0,"720x480"
SINFO:0,1,1,6202,"Audio"
SINFO:0,1,3,0,"eng"
SINFO:0,1,4,0,"English"
SINFO:0,1,5,0,"A_AC3"
SINFO:0,1,14,0,"6"
SINFO:0,2,1,6203,"Subtitles"
SINFO:0,2,3,0,"eng"
SINFO:0,2,4,0,"English"
TINFO:1,9,0,"0:07:20"
TINFO:1,11,0,"288346112"
TINFO:1,27,0,"01.mkv"
SINFO:1,0,1,6201,"Video"
SINFO:1,0,19,0,"720x480"
SINFO:1,1,1,6202,"Audio"
SINFO:1,1,3,0,"eng"
TINFO:23,9,0,"0:29:41"
TINFO:23,11,0,"1168541696"
TINFO:23,27,0,"23.mkv"
`;

describe("MakeMKV Parser", () => {
    it("parses raw output correctly", () => {
        const metadata = parseMakeMkvOutput(RAW_OUTPUT);
        expect(metadata).not.toBeNull();
        if (!metadata) return;

        expect(metadata.volumeLabel).toBe("Bluey - Season 3 - Second Half");
        expect(metadata.tracks.length).toBe(3); // We only included TINFO for 0, 1, and 23 in the abbreviated raw output above, wait, let me check the parser logic. 
        // The parser relies on TINFO to create tracks. I pasted a subset. 
        // Let's verify the subset parsing first.
        
        // Track 0
        const t0 = metadata.tracks.find(t => t.trackNumber === 0);
        expect(t0).toBeDefined();
        expect(t0?.duration).toBe("3:19:55");
        expect(t0?.size).toBe(7852398592);
        expect(t0?.video.width).toBe(720);
        expect(t0?.video.height).toBe(480);
        expect(t0?.audio.length).toBe(1);
        expect(t0?.audio[0].language).toBe("eng");
        expect(t0?.audio[0].channels).toBe(6);

        // Track 1
        const t1 = metadata.tracks.find(t => t.trackNumber === 1);
        expect(t1).toBeDefined();
        expect(t1?.duration).toBe("0:07:20");

        // Track 23
        const t23 = metadata.tracks.find(t => t.trackNumber === 23);
        expect(t23).toBeDefined();
        expect(t23?.duration).toBe("0:29:41");
    });
});
