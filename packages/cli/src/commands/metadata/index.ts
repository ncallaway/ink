import { Command } from "commander";
import { metadataRead } from "./read";
import { metadataList } from "./list";
import { metadataShow } from "./show";
import { metadataDelete } from "./delete";

export const defineCommand = (program: Command) => {
  // Metadata commands
  const metadata = program.command('metadata').description('Manage disc metadata');

  metadataList(metadata);
  metadataRead(metadata);
  metadataShow(metadata);
  metadataDelete(metadata);
}