import { ok, err, Result } from 'neverthrow';
import { platform } from 'node:os';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DevicePath } from '../types';

export function list(): Result<DevicePath[], Error> {
  const os = platform();

  if (os === 'linux') {
    return listDrivesLinux();
  } else {
    // macOS and Windows are not yet implemented
    return err(new Error(`Platform ${os} not yet supported for drive listing`));
  }
}

function listDrivesLinux(): Result<DevicePath[], Error> {
  try {
    const devices = readdirSync('/dev')
      .filter(file => file.startsWith('sr'))
      .map(file => join('/dev', file));
    
    return ok(devices);
  } catch (error) {
    return err(error as Error);
  }
}
