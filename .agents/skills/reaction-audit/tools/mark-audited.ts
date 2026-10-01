#!/usr/bin/env bun
/**
 * mark-audited — advance the reaction-audit mark to now, so the nudge resets
 * and audited samples are not offered again. Called at the end of an audit.
 */

import { writeAuditMark } from "../../../../src/hooks/lib/reaction-audit";

const now = new Date();
writeAuditMark(now);
console.log(`Reaction audit mark advanced to ${now.toISOString()}`);
