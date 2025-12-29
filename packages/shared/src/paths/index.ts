import * as path from "path";
import * as os from "os";
import { DiscId, TrackNumber } from "../types";

const ink = () => path.join(os.homedir(), '.ink');
const plans = () => path.join(ink(), 'plans');
const plan = (discId: DiscId) => path.join(plans(), `${discId}.json`);

const metadatas = () => path.join(ink(), 'metadata');
const metadata = (discId: DiscId) => path.join(metadatas(), `${discId}.json`);

const staging = () => path.join(ink(), 'staging');
const discStaging = (discId: DiscId) => path.join(staging(), discId);

const extracted = (discId: DiscId) => path.join(discStaging(discId), 'extracted');
const encoded = (discId: DiscId) => path.join(discStaging(discId), 'encoded');
const reviewed = (discId: DiscId) => path.join(discStaging(discId), 'reviewed');
const copied = (discId: DiscId) => path.join(discStaging(discId), 'copied');

const extractedVideo = (discId: DiscId, track: TrackNumber) => path.join(extracted(discId), `t${track.toString().padStart(2, '0')}.mkv`);
const encodedVideo = (discId: DiscId, track: TrackNumber) => path.join(encoded(discId), `t${track.toString().padStart(2, '0')}.mkv`);

export const paths = {
  ink,
  plans,
  plan,
  metadatas,
  metadata,

  staging,
  discStaging: {
    path: discStaging,
    extracted,
    encoded,
    reviewed,
    copied,

    extractedVideo,
    encodedVideo,

    markers: {
      extractedDone: (discId: DiscId, track: TrackNumber) => path.join(extracted(discId), `t${track.toString().padStart(2, '0')}.done`),
      encodedDone: (discId: DiscId, track: TrackNumber) => path.join(encoded(discId), `t${track.toString().padStart(2, '0')}.done`),
      reviewedDone: (discId: DiscId, track: TrackNumber) => path.join(reviewed(discId), `t${track.toString().padStart(2, '0')}.done`),
      copiedDone: (discId: DiscId, track: TrackNumber) => path.join(copied(discId), `t${track.toString().padStart(2, '0')}.done`),

      extractedRunning: (discId: DiscId, track: TrackNumber) => path.join(extracted(discId), `t${track.toString().padStart(2, '0')}.running`),
      encodedRunning: (discId: DiscId, track: TrackNumber) => path.join(encoded(discId), `t${track.toString().padStart(2, '0')}.running`),
      reviewedRunning: (discId: DiscId, track: TrackNumber) => path.join(reviewed(discId), `t${track.toString().padStart(2, '0')}.running`),
      copiedRunning: (discId: DiscId, track: TrackNumber) => path.join(copied(discId), `t${track.toString().padStart(2, '0')}.running`),
    },

    errors: {
      extracted: (discId: DiscId, track: TrackNumber) => path.join(extracted(discId), `t${track.toString().padStart(2, '0')}.error`),
      encoded: (discId: DiscId, track: TrackNumber) => path.join(encoded(discId), `t${track.toString().padStart(2, '0')}.error`),
      reviewed: (discId: DiscId, track: TrackNumber) => path.join(reviewed(discId), `t${track.toString().padStart(2, '0')}.error`),
      copied: (discId: DiscId, track: TrackNumber) => path.join(copied(discId), `t${track.toString().padStart(2, '0')}.error`),
    }
  }
}
