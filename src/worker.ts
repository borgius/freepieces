/** Cloudflare Workers entrypoint for the freepieces-branded worker.
 *  Registers built-in pieces then delegates to the shared factory. */

import { createFreepiecesWorker } from './worker/create-worker.js';
import './pieces/index.js';

export default createFreepiecesWorker();
export type { Env } from './framework/types.js';

