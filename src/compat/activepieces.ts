/**
 * Compatibility shims for Activepieces-style community nodes.
 *
 * Activepieces community pieces are typically authored using a builder API
 * like:
 *
 *   const myPiece = createPiece({
 *     name: 'my-piece',
 *     displayName: 'My Piece',
 *     auth: PieceAuth.OAuth2({ ... }),
 *     actions: [
 *       createAction({ name: 'doThing', ... })
 *     ]
 *   });
 *
 * This module re-exports the freepieces primitives under the names used by
 * the Activepieces framework so that community nodes can be ported with
 * minimal edits.
 *
 * Mapping
 * ───────
 *   @activepieces/pieces-framework  →  freepieces compat shim
 *   ─────────────────────────────────────────────────────────
 *   createPiece()                   →  createPiece()  (same)
 *   createAction()                  →  createAction() (adapter)
 *   PieceAuth.OAuth2()              →  PieceAuth.OAuth2() (adapter)
 *   PieceAuth.SecretText()          →  PieceAuth.SecretText() (adapter)
 *   Property.ShortText()            →  Property.ShortText() (adapter)
 *
 * Usage in a ported community node:
 *
 *   import {
 *     createPiece,
 *     createAction,
 *     PieceAuth,
 *     Property
 *   } from 'freepieces/compat';
 */

import { createPiece as _createPiece } from '../framework/piece';
import type {
  PieceDefinition,
  PieceAction,
  PieceActionContext,
  OAuth2AuthDefinition,
  ApiKeyAuthDefinition
} from '../framework/types';

// ---------------------------------------------------------------------------
// Re-export native builder
// ---------------------------------------------------------------------------
export { _createPiece as createPiece };

// ---------------------------------------------------------------------------
// createAction — wraps an Activepieces-style action descriptor
// ---------------------------------------------------------------------------
export interface ActivepiecesActionDescriptor {
  name: string;
  displayName: string;
  description?: string;
  props?: Record<string, ActivepiecesPropertyDefinition>;
  run(context: ActivepiecesContext): Promise<unknown>;
}

export interface ActivepiecesPropertyDefinition {
  displayName: string;
  required?: boolean;
  defaultValue?: unknown;
}

export interface ActivepiecesContext {
  auth: string | Record<string, string>;
  propsValue: Record<string, unknown>;
  /** Escape hatch to access the raw freepieces context. */
  _rawCtx: PieceActionContext;
}

/**
 * Wrap an Activepieces-style action descriptor into a freepieces PieceAction.
 */
export function createAction(descriptor: ActivepiecesActionDescriptor): PieceAction {
  return {
    name: descriptor.name,
    displayName: descriptor.displayName,
    description: descriptor.description,
    async run(ctx: PieceActionContext): Promise<unknown> {
      const apCtx: ActivepiecesContext = {
        auth: ctx.auth?.token ?? ctx.auth ?? '',
        propsValue: (ctx.props as Record<string, unknown>) ?? {},
        _rawCtx: ctx
      };
      return descriptor.run(apCtx);
    }
  };
}

// ---------------------------------------------------------------------------
// PieceAuth — Activepieces-compatible auth builders
// ---------------------------------------------------------------------------
export const PieceAuth = {
  /**
   * OAuth2 auth definition.
   *
   * @example
   *   auth: PieceAuth.OAuth2({
   *     authorizationUrl: 'https://github.com/login/oauth/authorize',
   *     tokenUrl: 'https://github.com/login/oauth/access_token',
   *     scope: ['repo', 'read:user'],
   *   })
   */
  OAuth2(options: {
    authorizationUrl: string;
    tokenUrl: string;
    scope: string[];
  }): OAuth2AuthDefinition {
    return {
      type: 'oauth2',
      authorizationUrl: options.authorizationUrl,
      tokenUrl: options.tokenUrl,
      scopes: options.scope
    };
  },

  /**
   * API-key / secret-text auth definition.
   *
   * @example
   *   auth: PieceAuth.SecretText({ description: 'Your API key' })
   */
  SecretText(_options?: { description?: string; headerName?: string }): ApiKeyAuthDefinition {
    return {
      type: 'apiKey',
      headerName: _options?.headerName
    };
  }
} as const;

// ---------------------------------------------------------------------------
// Property — Activepieces-compatible property builders (minimal subset)
// ---------------------------------------------------------------------------
export interface PropertyDefinition {
  displayName: string;
  required: boolean;
  defaultValue?: unknown;
}

export const Property = {
  ShortText(options: { displayName: string; required?: boolean; defaultValue?: string }): PropertyDefinition {
    return { displayName: options.displayName, required: options.required ?? false, defaultValue: options.defaultValue };
  },
  LongText(options: { displayName: string; required?: boolean; defaultValue?: string }): PropertyDefinition {
    return { displayName: options.displayName, required: options.required ?? false, defaultValue: options.defaultValue };
  },
  Number(options: { displayName: string; required?: boolean; defaultValue?: number }): PropertyDefinition {
    return { displayName: options.displayName, required: options.required ?? false, defaultValue: options.defaultValue };
  },
  Checkbox(options: { displayName: string; required?: boolean; defaultValue?: boolean }): PropertyDefinition {
    return { displayName: options.displayName, required: options.required ?? false, defaultValue: options.defaultValue ?? false };
  }
} as const;

// ---------------------------------------------------------------------------
// Re-export types for convenience
// ---------------------------------------------------------------------------
export type { PieceDefinition, PieceAction, PieceActionContext };
