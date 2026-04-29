/**
 * Piece registry — the only file that install/uninstall touches.
 *
 * Built-in pieces are listed explicitly below with registerPiece().
 * npm pieces each get one line: `import './npm-<name>.js'`
 * The wrapper file itself calls registerApPiece(), so one import = one registration.
 */

import { registerPiece } from '../framework/registry.js';
import { cloudflareD1Piece } from './cloudflare-d1.js';
import { cloudflareR2Piece } from './cloudflare-r2.js';
import { exampleOAuthPiece } from './example-oauth.js';
import { exampleApiKeyPiece } from './example-apikey.js';
import { gmailPiece } from './gmail.js';

registerPiece(cloudflareD1Piece);
registerPiece(cloudflareR2Piece);
registerPiece(exampleOAuthPiece);
registerPiece(exampleApiKeyPiece);
registerPiece(gmailPiece);

// @fp:pieces:start
import './npm-slack.js';
// @fp:pieces:end
