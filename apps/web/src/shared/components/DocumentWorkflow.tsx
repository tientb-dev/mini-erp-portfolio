import { ReactNode, useLayoutEffect, useRef, useState } from 'react';
import { Box, Paper, Stack, Step, StepLabel, Stepper, Tooltip, Typography } from '@mui/material';
import Check from '@mui/icons-material/Check';
import MoreHoriz from '@mui/icons-material/MoreHoriz';
import Close from '@mui/icons-material/Close';
import { useTranslation } from 'react-i18next';

export type WorkflowStepState = 'completed' | 'pending' | 'future' | 'rejected';

interface WorkflowStep {
  key: string;
  label: string;
  state: WorkflowStepState;
  details?: ReactNode;
  action?: ReactNode;
}

const marks = {
  completed: { color: '#2E7D32', icon: <Check /> },
  pending: { color: '#1F5FC4', icon: <MoreHoriz /> },
  future: { color: '#8793A5', icon: null },
  rejected: { color: '#D32F2F', icon: <Close /> },
};

export function DocumentWorkflowStepper({ steps, caption }: { steps: Pick<WorkflowStep, 'key' | 'label' | 'state'>[]; caption?: string }) {
  const { t } = useTranslation();
  return (
    <Stack sx={{ minHeight: 92, justifyContent: 'center', position: 'relative' }}>
      {caption && <Typography variant="caption" color="text.secondary" sx={{ alignSelf: 'flex-end', pr: 1 }}>{caption}</Typography>}
      <Stepper activeStep={steps.findIndex(step => step.state === 'pending')} alternativeLabel sx={{
        '& .MuiStepConnector-root': { top: 18, left: 'calc(-50% + 24px)', right: 'calc(50% + 24px)' },
        '& .MuiStepConnector-line': { borderTopWidth: 2 },
        '& .MuiStepLabel-label.MuiStepLabel-alternativeLabel': { mt: 1, fontSize: 14 },
      }}>
      {steps.map(step => (
        <Step key={step.key} completed={step.state === 'completed'} disabled={false}>
          <StepLabel error={step.state === 'rejected'} icon={
            <Box sx={{ display: 'grid', placeItems: 'center', width: 38, height: 38, borderRadius: '50%', color: 'white',
              border: '2px solid', borderColor: marks[step.state].color, bgcolor: step.state === 'future' ? 'transparent' : marks[step.state].color }}>
              {marks[step.state].icon}
            </Box>
          }
            aria-label={`${step.label}: ${t(`pr.stepState.${step.state}`)}`} data-step-state={step.state}>
            {step.label}
          </StepLabel>
        </Step>
      ))}
      </Stepper>
    </Stack>
  );
}

export function DocumentWorkflowNodes({ steps }: { steps: WorkflowStep[] }) {
  const hasActions = steps.some(step => step.action);
  return (
    <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
      {steps.map(step => (
        <Paper key={step.key} variant="outlined" sx={{ flex: 1, p: 2, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <Typography sx={{ fontSize: 16, fontWeight: 600, mb: 1.5 }}>{step.label}</Typography>
          <Stack spacing={1.5} sx={{ flexGrow: 1 }}>{step.details}</Stack>
          {hasActions && <Box sx={{ mt: 1, height: 32, display: 'flex', justifyContent: 'flex-end', '& .MuiButton-root': { height: 32 } }}>{step.action}</Box>}
        </Paper>
      ))}
    </Stack>
  );
}

export function WorkflowCardField({ label, value, control, badge, alignControl }: {
  label: string; value?: string | null; control?: ReactNode; badge?: ReactNode; alignControl?: boolean;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [truncated, setTruncated] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setTruncated(el.scrollWidth > el.clientWidth);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [value, control]);
  return <Box sx={{ minWidth: 0, height: alignControl ? 64 : undefined }}>
    {control ?? <>
    <Typography component="div" sx={{ fontSize: 13, fontWeight: 600, lineHeight: 1.4, color: 'text.secondary' }}>{label}</Typography>
    {badge ?? <Tooltip title={truncated ? value : ''} describeChild>
      <Typography ref={ref} component="span" tabIndex={truncated ? 0 : undefined}
        noWrap sx={{ fontSize: 14, display: 'block' }}>{value || '—'}</Typography>
    </Tooltip>}
    </>}
  </Box>;
}
