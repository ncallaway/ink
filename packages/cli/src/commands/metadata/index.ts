import { Command } from "commander";
import { metadataRead } from "./read";

export const defineCommand = (program: Command) => {
  // Metadata commands
  const metadata = program.command('metadata').description('Manage disc metadata');


  metadata
    .command('list')
    .description('List all collected metadata')
    .action(() => {
      console.log('TODO: Implement metadata list');
    });

  metadataRead(metadata);

  metadata
    .command('show <disc-id>')
    .description('Show detailed metadata for a specific disc')
    .action((discId) => {
      console.log(`TODO: Show metadata for ${discId}`);
    });

  metadata
    .command('delete <disc-id>')
    .description('Delete metadata for a specific disc')
    .action((discId) => {
      console.log(`TODO: Delete metadata for ${discId}`);
    });
}
