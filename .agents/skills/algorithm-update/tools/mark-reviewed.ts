#!/usr/bin/env bun
/**
 * mark-reviewed — advance the algorithm-review high-water mark to now, so the
 * cadence nudge resets and already-reviewed reflections are not re-counted.
 * Called at the end of an /algorithm-update session.
 */

import { writeReviewMark } from "../../../../src/hooks/lib/algorithm-review";

const ts = new Date().toISOString();
writeReviewMark(ts);
console.log(`Algorithm review mark advanced to ${ts}`);
