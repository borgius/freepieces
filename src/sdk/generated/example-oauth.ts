// Hand-written types for the native example-oauth piece.

export interface ExampleOAuthGetUserOutput {
  login: string;
  id: number;
  name: string | null;
  email: string | null;
  avatar_url: string;
  [key: string]: unknown;
}

export interface ExampleOAuthClient {
  /** Returns the GitHub profile of the authenticated user. */
  'get-user'(input?: Record<string, unknown>): Promise<ExampleOAuthGetUserOutput>;
}
