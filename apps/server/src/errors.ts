import type { ErrorCode } from "@playwithtv/protocol";

export class HubError extends Error {
  constructor(public code: ErrorCode, message: string, public status = 400) {
    super(message);
  }
}

/** Counters for the admin console and /metrics. */
export const metrics = {
  roomsCreated: 0, joins: 0, rejoins: 0, inputsRelayed: 0, inputsDropped: 0, staleInputs: 0,
  rateLimited: 0, badMessages: 0, roomsExpired: 0, matchesFinished: 0, rtcSignals: 0,
};
