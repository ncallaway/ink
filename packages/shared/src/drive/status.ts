import { ok, err, Result } from 'neverthrow';
import { platform } from 'node:os';
import { openSync, closeSync, constants } from 'node:fs';
import { dlopen } from 'bun:ffi';
import { DevicePath, DriveStatus } from '../types';

const CDROM_DRIVE_STATUS = 0x5326;

export function status(devicePath: DevicePath): Result<DriveStatus, Error> {
  const os = platform();

  if (os === 'linux') {
    return detectTrayLinux(devicePath);
  } else if (os === 'darwin') {
    // Ideally the mac version can share the linux version implementation.
    // However, the ioctl request code (0x5326) is Linux-specific.
    // macOS would require using IOKit or a different ioctl request.
    // Keeping the structure similar for future implementation.
    return err(new Error("MacOS drive status detection is not yet implemented."));
  } else if (os === 'win32') {
    return detectTrayWindows(devicePath);
  }

  return err(new Error(`Unsupported platform: ${os}`));
}

function detectTrayLinux(devicePath: string): Result<DriveStatus, Error> {
  let fd: number | null = null;

  try {
    // Open device in non-blocking mode
    // O_RDONLY | O_NONBLOCK
    fd = openSync(devicePath, constants.O_RDONLY | constants.O_NONBLOCK);

    // Load libc for ioctl
    // On Linux, libc is typically libc.so.6
    const libName = 'libc.so.6'; 
    
    const { symbols } = dlopen(libName, {
      ioctl: {
        // ioctl(int fd, int request, ...)
        // We define the specific signature we need: ioctl(int, int)
        args: ["int", "int"],
        returns: "int",
      },
    });

    const status = symbols.ioctl(fd, CDROM_DRIVE_STATUS);

    if (status < 0) {
       return err(new Error(`ioctl failed with status: ${status}`));
    }
    
    return ok(status as DriveStatus);

  } catch (error) {
    return err(error as Error);
  } finally {
    if (fd !== null) {
      try {
        closeSync(fd);
      } catch {
        // Ignore close errors
      }
    }
  }
}

function detectTrayWindows(_devicePath: string): Result<DriveStatus, Error> {
  // Windows Implementation Pseudo-code:
  // 
  // import { CreateFile, DeviceIoControl, CloseHandle } from 'win32-api';
  // 
  // const handle = CreateFile(
  //   devicePath, // e.g. "\\.\D:"
  //   GENERIC_READ,
  //   FILE_SHARE_READ,
  //   null,
  //   OPEN_EXISTING,
  //   0,
  //   null
  // );
  //
  // const status = DeviceIoControl(handle, IOCTL_STORAGE_CHECK_VERIFY2, ...);
  // CloseHandle(handle);
  // 
  // return mapWindowsStatus(status);

  return err(new Error("Windows drive status detection is not yet implemented."));
}
