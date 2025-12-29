import { err, ok, Result, ResultAsync } from "neverthrow";
import { BackupPlan, DiscId, TrackPlan, TrackQueue, TrackQueueStatus, TrackState, TrackStatus } from "../types"
import { toError } from "../util";
import { storage } from "../storage";
import { paths } from "../paths";
import { fmt } from "../fmt";

type QueueRule = {
  eligible: (plan: BackupPlan, track: TrackPlan) => Promise<boolean>;
  done: (plan: BackupPlan, track: TrackPlan) => Promise<boolean>;
  error: (plan: BackupPlan, track: TrackPlan) => Promise<boolean>;
  running: (plan: BackupPlan, track: TrackPlan) => Promise<boolean>;
  ready: (plan: BackupPlan, track: TrackPlan) => Promise<boolean>;
}

const EXTRACT_QUEUE: QueueRule = {
  eligible: async (_plan, track) => track.extract,
  done: async (plan, track) => storage.markerPresent(paths.discStaging.markers.extractedDone(plan.discId, track.trackNumber)),
  error: async (plan, track) => storage.markerPresent(paths.discStaging.errors.extracted(plan.discId, track.trackNumber)),
  running: async (plan, track) => storage.markerPresent(paths.discStaging.markers.extractedRunning(plan.discId, track.trackNumber)),
  ready: async (_plan, _track) => true
};
const TRANSCODE_QUEUE: QueueRule = {
  eligible: async (plan, track) => {
    if (!track.extract) return false;
    // Ignored tracks are not eligible for transcode
    const ignored = await storage.markerPresent(paths.discStaging.markers.reviewedIgnored(plan.discId, track.trackNumber));
    return !ignored;
  },
  done: async (plan, track) => storage.markerPresent(paths.discStaging.markers.encodedDone(plan.discId, track.trackNumber)),
  error: async (plan, track) => storage.markerPresent(paths.discStaging.errors.encoded(plan.discId, track.trackNumber)),
  running: async (plan, track) => storage.markerPresent(paths.discStaging.markers.encodedRunning(plan.discId, track.trackNumber)),

  // ready when extract is done
  ready: async (plan, track) => EXTRACT_QUEUE.done(plan, track),
};
const REVIEW_QUEUE: QueueRule = {
  eligible: async (plan, track) => track.extract && plan.type === 'tv',
  done: async (plan, track) => {
    const done = await storage.markerPresent(paths.discStaging.markers.reviewedDone(plan.discId, track.trackNumber));
    if (done) return true;
    return storage.markerPresent(paths.discStaging.markers.reviewedIgnored(plan.discId, track.trackNumber));
  },
  error: async (plan, track) => storage.markerPresent(paths.discStaging.errors.reviewed(plan.discId, track.trackNumber)),
  running: async (plan, track) => storage.markerPresent(paths.discStaging.markers.reviewedRunning(plan.discId, track.trackNumber)),

  // ready when extract is done
  ready: async (plan, track) => EXTRACT_QUEUE.done(plan, track),
};
const COPY_QUEUE: QueueRule = {
  eligible: async (plan, track) => {
    if (!track.extract) return false;
    // Ignored tracks are not eligible for copy
    const ignored = await storage.markerPresent(paths.discStaging.markers.reviewedIgnored(plan.discId, track.trackNumber));
    return !ignored;
  },
  done: async (plan, track) => storage.markerPresent(paths.discStaging.markers.copiedDone(plan.discId, track.trackNumber)),
  error: async (plan, track) => storage.markerPresent(paths.discStaging.errors.copied(plan.discId, track.trackNumber)),
  running: async (plan, track) => storage.markerPresent(paths.discStaging.markers.copiedRunning(plan.discId, track.trackNumber)),

  // ready when: encode is done AND (ready is not eligile OR ready is done)
  ready: async (plan, track) => {
    const encodeDone = await TRANSCODE_QUEUE.done(plan, track);
    if (!encodeDone) { return false; }

    const reviewEligible = await REVIEW_QUEUE.eligible(plan, track);
    // encode is done, and review is not eligible
    if (!reviewEligible) { return true; }

    return REVIEW_QUEUE.done(plan, track);
  }
};

const QUEUE_RULES: Record<TrackQueue, QueueRule> = {
  extract: EXTRACT_QUEUE,
  transcode: TRANSCODE_QUEUE,
  review: REVIEW_QUEUE,
  copy: COPY_QUEUE
}

const queueStatus = async (plan: BackupPlan, track: TrackPlan, queue: TrackQueue): Promise<Result<TrackQueueStatus, Error>>  => {
  const rule = QUEUE_RULES[queue];

  if (!rule) {
    return err(new Error(`Could not fetch track queue status. Unknown queue: ${queue}`));
  }

  if (!await rule.eligible(plan, track)) {
    return ok('ineligible');
  }

  // check for done 
  if (await rule.done(plan, track)) {
    return ok('done');
  }

  // check for error 
  if (await rule.error(plan, track)) {
    return ok('error');
  }
  
  // check for running 
  if (await rule.running(plan, track)) {
    return ok('running');
  }

  // check for ready
  if (await rule.ready(plan, track)) {
    return ok('ready');
  }

  // must be blocked
  return ok('blocked');

}

const QUEUES: TrackQueue[] = ['extract', 'transcode', 'review', 'copy'];
const state = async (plan: BackupPlan, track: TrackPlan): Promise<Result<TrackState, Error>> => {
  // @ts-expect-error - partial {}
  const queues: Record<TrackQueue, TrackQueueStatus> = {}; 
  for (const q of QUEUES) {
    const statusRes = await queueStatus(plan, track, q);
    queues[q] = statusRes.unwrapOr('error');
  }

  // a track is complete when:
  // -- all track queues are *done* or *ineligible*
  const isComplete = Object.values(queues).every(s => s === 'done' || s === 'ineligible');
  const isError = Object.values(queues).some(s => s === 'error');
  const isStarted = Object.values(queues).some(s => s === 'done' || s === 'running');
  const isIgnored = await storage.markerPresent(paths.discStaging.markers.reviewedIgnored(plan.discId, track.trackNumber));

  let status: TrackStatus = 'ready';
  if (isStarted) { status = 'running'; }
  if (isError) { status = 'error'; }
  if (isComplete) { status = 'complete'; }
  if (isIgnored) { status = 'ignored'; }

  return ok({
    queues,
    status
  });
}

export const tracks = {
  queueStatus,
  state 
}
