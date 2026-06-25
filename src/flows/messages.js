// Drip-message content now lives in the JSON content file (src/content/ru.json),
// loaded and interpolated by src/content/loadContent.js. This module re-exports
// it under the same names the scheduler/bot already use, so no scheduling or
// handler logic changes.
import { content } from '../content/loadContent.js';

export const common = content.common;
export const welcomeMessages = content.messages.welcome;
export const warmupMessages = content.messages.warmup;
export const liveMessages = content.messages.live;
export const followMessages = content.messages.follow;
export const noShowMessage = content.messages.noShow;
