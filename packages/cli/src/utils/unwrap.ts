import { Result } from 'neverthrow';

export const unwrapOrExit = <K>(res: Result<K, Error>, code: number, message?: string): K => {
  return res.match(ok => ok, err => {
    if (message) {
      console.error("Failed to read metadata files", err);
    } else {
      console.error(err);
    }

    process.exit(code);
  });
}
