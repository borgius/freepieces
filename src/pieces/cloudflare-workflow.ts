import { createPiece } from '../framework/piece';
import type { Env, PieceActionContext, PropDefinition } from '../framework/types';

const DEFAULT_WORKFLOW_BINDING = 'WORKFLOW';

const workflowBindingProp: PropDefinition = {
  type: 'SHORT_TEXT',
  displayName: 'Workflow binding name',
  description: `Worker binding name for the Cloudflare Workflow. Defaults to ${DEFAULT_WORKFLOW_BINDING}.`,
  required: false,
  defaultValue: DEFAULT_WORKFLOW_BINDING,
};

const instanceIdProp: PropDefinition = {
  type: 'SHORT_TEXT',
  displayName: 'Instance ID',
  description: 'Cloudflare Workflow instance ID.',
  required: true,
};

function getProps(ctx: PieceActionContext): Record<string, unknown> {
  return ctx.props ?? {};
}

function readOptionalString(props: Record<string, unknown>, key: string): string | undefined {
  const value = props[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function readString(props: Record<string, unknown>, key: string): string {
  const value = props[key];
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${key} is required`);
  return value;
}

function getWorkflow(env: Env, props: Record<string, unknown>): Workflow {
  const bindingName = readOptionalString(props, 'workflowBinding') ?? DEFAULT_WORKFLOW_BINDING;
  const binding = env[bindingName] as Workflow | undefined;
  if (!binding || typeof binding.create !== 'function' || typeof binding.get !== 'function') {
    throw new Error(`Workflow binding "${bindingName}" was not found`);
  }
  return binding;
}

function readRetention(props: Record<string, unknown>): WorkflowInstanceCreateOptions['retention'] | undefined {
  const successRetention = readOptionalString(props, 'successRetention');
  const errorRetention = readOptionalString(props, 'errorRetention');
  if (!successRetention && !errorRetention) return undefined;
  return {
    successRetention: successRetention as WorkflowRetentionDuration | undefined,
    errorRetention: errorRetention as WorkflowRetentionDuration | undefined,
  };
}

function readCreateOptions(props: Record<string, unknown>): WorkflowInstanceCreateOptions {
  return {
    id: readOptionalString(props, 'id'),
    params: props['params'],
    retention: readRetention(props),
  };
}

function serializeInstance(instance: WorkflowInstance): { id: string } {
  return { id: instance.id };
}

async function getInstance(workflow: Workflow, props: Record<string, unknown>): Promise<WorkflowInstance> {
  return workflow.get(readString(props, 'id'));
}

async function createInstance(ctx: PieceActionContext): Promise<unknown> {
  const props = getProps(ctx);
  const instance = await getWorkflow(ctx.env, props).create(readCreateOptions(props));
  return { instance: serializeInstance(instance) };
}

async function createBatch(ctx: PieceActionContext): Promise<unknown> {
  const props = getProps(ctx);
  const instances = props['instances'];
  if (!Array.isArray(instances) || instances.length === 0) {
    throw new Error('instances must be a non-empty array');
  }
  if (instances.length > 100) throw new Error('instances cannot contain more than 100 entries');

  const batch = instances.map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error('each instance must be an object');
    }
    return readCreateOptions(entry as Record<string, unknown>);
  });
  const created = await getWorkflow(ctx.env, props).createBatch(batch);
  return { instances: created.map(serializeInstance) };
}

async function getStatus(ctx: PieceActionContext): Promise<unknown> {
  const props = getProps(ctx);
  const instance = await getInstance(getWorkflow(ctx.env, props), props);
  return { id: instance.id, status: await instance.status() };
}

async function runInstanceOperation(
  ctx: PieceActionContext,
  operation: 'pause' | 'resume' | 'terminate' | 'restart',
): Promise<unknown> {
  const props = getProps(ctx);
  const instance = await getInstance(getWorkflow(ctx.env, props), props);
  await instance[operation]();
  return { ok: true, id: instance.id };
}

async function sendEvent(ctx: PieceActionContext): Promise<unknown> {
  const props = getProps(ctx);
  const instance = await getInstance(getWorkflow(ctx.env, props), props);
  await instance.sendEvent({ type: readString(props, 'type'), payload: props['payload'] });
  return { ok: true, id: instance.id };
}

async function pauseInstance(ctx: PieceActionContext): Promise<unknown> {
  return runInstanceOperation(ctx, 'pause');
}

async function resumeInstance(ctx: PieceActionContext): Promise<unknown> {
  return runInstanceOperation(ctx, 'resume');
}

async function terminateInstance(ctx: PieceActionContext): Promise<unknown> {
  return runInstanceOperation(ctx, 'terminate');
}

async function restartInstance(ctx: PieceActionContext): Promise<unknown> {
  return runInstanceOperation(ctx, 'restart');
}

export const cloudflareWorkflowPiece = createPiece({
  name: 'cloudflare-workflow',
  displayName: 'Cloudflare Workflow',
  description: 'Create and manage Cloudflare Workflow instances through a Workflow binding.',
  version: '0.1.0',
  auth: { type: 'none' },
  actions: [
    {
      name: 'create_instance',
      displayName: 'Create Instance',
      description: 'Create a Cloudflare Workflow instance.',
      props: {
        workflowBinding: workflowBindingProp,
        id: { type: 'SHORT_TEXT', displayName: 'Instance ID', required: false },
        params: { type: 'JSON', displayName: 'Params', required: false },
        successRetention: { type: 'SHORT_TEXT', displayName: 'Success retention', required: false },
        errorRetention: { type: 'SHORT_TEXT', displayName: 'Error retention', required: false },
      },
      run: createInstance,
    },
    {
      name: 'create_batch',
      displayName: 'Create Batch',
      description: 'Create up to 100 Cloudflare Workflow instances.',
      props: {
        workflowBinding: workflowBindingProp,
        instances: { type: 'JSON', displayName: 'Instances', required: true },
      },
      run: createBatch,
    },
    {
      name: 'get_status',
      displayName: 'Get Status',
      description: 'Read the current status for a Workflow instance.',
      props: { workflowBinding: workflowBindingProp, id: instanceIdProp },
      run: getStatus,
    },
    {
      name: 'pause_instance',
      displayName: 'Pause Instance',
      description: 'Pause a Workflow instance.',
      props: { workflowBinding: workflowBindingProp, id: instanceIdProp },
      run: pauseInstance,
    },
    {
      name: 'resume_instance',
      displayName: 'Resume Instance',
      description: 'Resume a Workflow instance.',
      props: { workflowBinding: workflowBindingProp, id: instanceIdProp },
      run: resumeInstance,
    },
    {
      name: 'terminate_instance',
      displayName: 'Terminate Instance',
      description: 'Terminate a Workflow instance.',
      props: { workflowBinding: workflowBindingProp, id: instanceIdProp },
      run: terminateInstance,
    },
    {
      name: 'restart_instance',
      displayName: 'Restart Instance',
      description: 'Restart a Workflow instance.',
      props: { workflowBinding: workflowBindingProp, id: instanceIdProp },
      run: restartInstance,
    },
    {
      name: 'send_event',
      displayName: 'Send Event',
      description: 'Send an event to a Workflow instance.',
      props: {
        workflowBinding: workflowBindingProp,
        id: instanceIdProp,
        type: { type: 'SHORT_TEXT', displayName: 'Event type', required: true },
        payload: { type: 'JSON', displayName: 'Payload', required: false },
      },
      run: sendEvent,
    },
  ],
});
