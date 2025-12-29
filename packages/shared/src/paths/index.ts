import * as path from "path";
import * as os from "os";
import { DiscId } from "../types";

const ink = () => path.join(os.homedir(), '.ink');
const plans = () => path.join(ink(), 'plans');
const plan = (discId: DiscId) => path.join(plans(), `${discId}.json`);

const metadatas = () => path.join(ink(), 'metadata');
const metadata = (discId: DiscId) => path.join(metadatas(), `${discId}.json`);

export const paths = {
  ink,
  plans,
  plan,
  metadatas,
  metadata
}
