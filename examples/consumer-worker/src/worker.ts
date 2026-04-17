/**
 * Consumer worker example — demonstrates how to use freepieces as a library.
 *
 * 1. Import the factory from 'freepieces/worker'.
 * 2. Register any pieces you want (AP community pieces or native pieces).
 * 3. Default-export the result.
 */

import { createFreepiecesWorker } from 'freepieces/worker';
import './pieces/index.js';

export default createFreepiecesWorker();
