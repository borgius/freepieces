// Hand-written types for the native cloudflare-workflow piece.

export type CloudflareWorkflowInstanceState =
  | 'queued'
  | 'running'
  | 'paused'
  | 'errored'
  | 'terminated'
  | 'complete'
  | 'waiting'
  | 'waitingForPause'
  | 'unknown';

export interface CloudflareWorkflowBindingInput {
  /** Worker Workflow binding name. Defaults to WORKFLOW. */
  workflowBinding?: string;
}

export interface CloudflareWorkflowRetentionInput {
  successRetention?: string;
  errorRetention?: string;
}

export interface CloudflareWorkflowCreateInstanceInput
  extends CloudflareWorkflowBindingInput, CloudflareWorkflowRetentionInput {
  id?: string;
  params?: unknown;
}

export interface CloudflareWorkflowCreateBatchEntry extends CloudflareWorkflowRetentionInput {
  id?: string;
  params?: unknown;
}

export interface CloudflareWorkflowCreateBatchInput extends CloudflareWorkflowBindingInput {
  instances: CloudflareWorkflowCreateBatchEntry[];
}

export interface CloudflareWorkflowInstanceInput extends CloudflareWorkflowBindingInput {
  id: string;
}

export interface CloudflareWorkflowSendEventInput extends CloudflareWorkflowInstanceInput {
  type: string;
  payload?: unknown;
}

export interface CloudflareWorkflowInstanceSummary {
  id: string;
}

export interface CloudflareWorkflowInstanceOutput {
  instance: CloudflareWorkflowInstanceSummary;
}

export interface CloudflareWorkflowBatchOutput {
  instances: CloudflareWorkflowInstanceSummary[];
}

export interface CloudflareWorkflowStatusOutput {
  id: string;
  status: {
    status: CloudflareWorkflowInstanceState;
    error?: { name: string; message: string };
    output?: unknown;
  };
}

export interface CloudflareWorkflowOperationOutput {
  ok: true;
  id: string;
}

export interface CloudflareWorkflowClient {
  /** Create a Cloudflare Workflow instance. */
  create_instance(input?: CloudflareWorkflowCreateInstanceInput): Promise<CloudflareWorkflowInstanceOutput>;
  /** Create up to 100 Cloudflare Workflow instances. */
  create_batch(input: CloudflareWorkflowCreateBatchInput): Promise<CloudflareWorkflowBatchOutput>;
  /** Read the current status for a Workflow instance. */
  get_status(input: CloudflareWorkflowInstanceInput): Promise<CloudflareWorkflowStatusOutput>;
  /** Pause a Workflow instance. */
  pause_instance(input: CloudflareWorkflowInstanceInput): Promise<CloudflareWorkflowOperationOutput>;
  /** Resume a Workflow instance. */
  resume_instance(input: CloudflareWorkflowInstanceInput): Promise<CloudflareWorkflowOperationOutput>;
  /** Terminate a Workflow instance. */
  terminate_instance(input: CloudflareWorkflowInstanceInput): Promise<CloudflareWorkflowOperationOutput>;
  /** Restart a Workflow instance. */
  restart_instance(input: CloudflareWorkflowInstanceInput): Promise<CloudflareWorkflowOperationOutput>;
  /** Send an event to a Workflow instance. */
  send_event(input: CloudflareWorkflowSendEventInput): Promise<CloudflareWorkflowOperationOutput>;
}
