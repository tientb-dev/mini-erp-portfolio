import { HttpStatus } from '@nestjs/common';
import { BusinessError, DocHeader } from './workflow';

export const WORKFLOW_STEPS = ['CREATE', 'APPROVAL', 'RECEIPT', 'CLOSED'] as const;
export type WorkflowStep = typeof WORKFLOW_STEPS[number];
export interface ActionContext {
  version: number;
  round: number;
  step: WorkflowStep;
}

export function assertActionContext(doc: DocHeader, round: number, step: WorkflowStep, expected: ActionContext) {
  if (doc.version !== expected.version || round !== expected.round || step !== expected.step) {
    throw new BusinessError('STALE_WORKFLOW_CONTEXT', 'Reload the document and confirm the action again', HttpStatus.CONFLICT);
  }
}
