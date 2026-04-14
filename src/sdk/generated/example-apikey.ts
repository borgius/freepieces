// Hand-written types for the native example-apikey piece.

export interface ExampleApiKeyPingInput {}

export interface ExampleApiKeyPingOutput {
  ok: boolean;
  authConfigured: boolean;
  props: Record<string, unknown>;
  timestamp: string;
}

export interface ExampleApiKeyEchoInput {}

export interface ExampleApiKeyEchoOutput {
  echo: Record<string, unknown>;
}

export interface ExampleApiKeyClient {
  /** Returns a success payload confirming the piece is reachable. */
  ping(input?: ExampleApiKeyPingInput): Promise<ExampleApiKeyPingOutput>;
  /** Echoes back any props passed to the action. */
  echo(input?: ExampleApiKeyEchoInput): Promise<ExampleApiKeyEchoOutput>;
}
