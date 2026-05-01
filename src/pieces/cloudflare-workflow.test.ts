import { describe, expect, it } from 'vitest';

import { cloudflareWorkflowPiece } from './cloudflare-workflow';
import type { Env } from '../framework/types';

class FakeWorkflowInstance {
  operations: string[] = [];
  events: Array<{ type: string; payload: unknown }> = [];

  constructor(public id: string) {}

  async pause(): Promise<void> {
    this.operations.push('pause');
  }

  async resume(): Promise<void> {
    this.operations.push('resume');
  }

  async terminate(): Promise<void> {
    this.operations.push('terminate');
  }

  async restart(): Promise<void> {
    this.operations.push('restart');
  }

  async status(): Promise<InstanceStatus> {
    return { status: 'running', output: { id: this.id } };
  }

  async sendEvent(event: { type: string; payload: unknown }): Promise<void> {
    this.events.push(event);
  }
}

class FakeWorkflow {
  created: WorkflowInstanceCreateOptions[] = [];
  batch: WorkflowInstanceCreateOptions[] = [];
  instances = new Map<string, FakeWorkflowInstance>();

  async create(options?: WorkflowInstanceCreateOptions): Promise<FakeWorkflowInstance> {
    const instance = new FakeWorkflowInstance(options?.id ?? 'generated-id');
    this.created.push(options ?? {});
    this.instances.set(instance.id, instance);
    return instance;
  }

  async createBatch(batch: WorkflowInstanceCreateOptions[]): Promise<FakeWorkflowInstance[]> {
    this.batch = batch;
    return batch.map((options, index) => new FakeWorkflowInstance(options.id ?? `generated-${index}`));
  }

  async get(id: string): Promise<FakeWorkflowInstance> {
    const instance = this.instances.get(id) ?? new FakeWorkflowInstance(id);
    this.instances.set(id, instance);
    return instance;
  }
}

function createEnv(workflow = new FakeWorkflow()): Env {
  return { WORKFLOW: workflow } as unknown as Env;
}

function getAction(name: string) {
  const action = cloudflareWorkflowPiece.actions.find((entry) => entry.name === name);
  if (!action) throw new Error(`Missing action ${name}`);
  return action;
}

describe('cloudflareWorkflowPiece', () => {
  it('defines a no-auth Cloudflare Workflow piece', () => {
    expect(cloudflareWorkflowPiece.name).toBe('cloudflare-workflow');
    expect(cloudflareWorkflowPiece.auth.type).toBe('none');
    expect(cloudflareWorkflowPiece.actions.map((action) => action.name)).toEqual([
      'create_instance',
      'create_batch',
      'get_status',
      'pause_instance',
      'resume_instance',
      'terminate_instance',
      'restart_instance',
      'send_event',
    ]);
  });

  it('creates an instance with params and retention', async () => {
    const workflow = new FakeWorkflow();
    const result = await getAction('create_instance').run({
      env: createEnv(workflow),
      props: {
        id: 'job-1',
        params: { file: 'input.json' },
        successRetention: '1 day',
        errorRetention: '1 week',
      },
    });

    expect(result).toEqual({ instance: { id: 'job-1' } });
    expect(workflow.created).toEqual([{
      id: 'job-1',
      params: { file: 'input.json' },
      retention: { successRetention: '1 day', errorRetention: '1 week' },
    }]);
  });

  it('creates a batch of workflow instances', async () => {
    const workflow = new FakeWorkflow();
    const result = await getAction('create_batch').run({
      env: createEnv(workflow),
      props: {
        instances: [
          { id: 'job-1', params: { n: 1 } },
          { id: 'job-2', params: { n: 2 }, errorRetention: '1 day' },
        ],
      },
    });

    expect(result).toEqual({ instances: [{ id: 'job-1' }, { id: 'job-2' }] });
    expect(workflow.batch).toEqual([
      { id: 'job-1', params: { n: 1 }, retention: undefined },
      { id: 'job-2', params: { n: 2 }, retention: { successRetention: undefined, errorRetention: '1 day' } },
    ]);
  });

  it('gets instance status', async () => {
    const result = await getAction('get_status').run({
      env: createEnv(),
      props: { id: 'job-1' },
    });

    expect(result).toEqual({ id: 'job-1', status: { status: 'running', output: { id: 'job-1' } } });
  });

  it('runs instance operations', async () => {
    const workflow = new FakeWorkflow();
    const instance = await workflow.get('job-1');

    const result = await getAction('pause_instance').run({
      env: createEnv(workflow),
      props: { id: 'job-1' },
    });

    expect(result).toEqual({ ok: true, id: 'job-1' });
    expect(instance.operations).toEqual(['pause']);
  });

  it('sends events to an instance', async () => {
    const workflow = new FakeWorkflow();
    const instance = await workflow.get('job-1');

    const result = await getAction('send_event').run({
      env: createEnv(workflow),
      props: { id: 'job-1', type: 'approved', payload: { by: 'user' } },
    });

    expect(result).toEqual({ ok: true, id: 'job-1' });
    expect(instance.events).toEqual([{ type: 'approved', payload: { by: 'user' } }]);
  });

  it('throws when the requested binding is missing', async () => {
    await expect(getAction('get_status').run({
      env: createEnv(),
      props: { workflowBinding: 'MISSING_WORKFLOW', id: 'job-1' },
    })).rejects.toThrow('Workflow binding "MISSING_WORKFLOW" was not found');
  });
});
