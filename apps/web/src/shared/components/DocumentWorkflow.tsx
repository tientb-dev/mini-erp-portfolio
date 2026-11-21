import { ReactNode } from 'react';
import { Paper, Stack, Step, StepLabel, Stepper, Typography } from '@mui/material';

interface WorkflowStep {
  key: string;
  label: string;
  completed?: boolean;
  details?: ReactNode;
}

export function DocumentWorkflowStepper({ steps, active }: { steps: WorkflowStep[]; active: number }) {
  return (
    <Stepper activeStep={active} alternativeLabel>
      {steps.map(step => <Step key={step.key} completed={step.completed}><StepLabel>{step.label}</StepLabel></Step>)}
    </Stepper>
  );
}

export function DocumentWorkflowNodes({ steps }: { steps: WorkflowStep[] }) {
  return (
    <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
      {steps.map(step => (
        <Paper key={step.key} variant="outlined" sx={{ flex: 1, p: 2, minWidth: 0 }}>
          <Typography variant="subtitle2" sx={{ mb: 1 }}>{step.label}</Typography>
          {step.details}
        </Paper>
      ))}
    </Stack>
  );
}
