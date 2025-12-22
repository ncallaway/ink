import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

const driveScan = async () => await execAsync('makemkvcon -r info disc:9999');

export const makemkv = {
  driveScan
}
