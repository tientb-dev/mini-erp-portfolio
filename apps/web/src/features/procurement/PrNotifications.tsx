import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, IconButton, ListItemText, Menu, MenuItem } from '@mui/material';
import NotificationsOutlined from '@mui/icons-material/NotificationsOutlined';
import { useTranslation } from 'react-i18next';
import { api } from '../../services/api-client';
import { fmtDate } from '../../shared/utils/format';

interface Notification {
  id: number;
  prId: number;
  documentNumber: string;
  action: string;
  createdAt: string;
  reason: string | null;
  readAt: string | null;
  taskStep: string | null;
  resolvedAt: string | null;
}

export function PrNotifications({ userId, openPr }: { userId: number; openPr: (id: number) => void }) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const key = ['pr-notifications', userId];
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const query = useQuery({
    queryKey: key, queryFn: () => api<Notification[]>('/pr-notifications'), refetchInterval: 30_000,
  });
  const read = useMutation({
    mutationFn: (id: number) => api(`/pr-notifications/${id}/read`, { method: 'PATCH' }),
    onSuccess: () => void client.invalidateQueries({ queryKey: key }),
  });
  const notifications = query.data ?? [];
  const unread = notifications.filter(n => !n.readAt && !n.resolvedAt).length;

  return (
    <>
      <IconButton aria-label={t('pr.notifications')} aria-haspopup="menu" aria-expanded={Boolean(anchor)}
        onClick={event => setAnchor(event.currentTarget)}>
        <Badge badgeContent={unread} color="primary"><NotificationsOutlined /></Badge>
      </IconButton>
      <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)}>
        {query.isError && <MenuItem disabled>{query.error.message}</MenuItem>}
        {!notifications.length && !query.isError && <MenuItem disabled>{t('pr.noNotifications')}</MenuItem>}
        {notifications.map(n => (
          <MenuItem key={n.id} onClick={() => { setAnchor(null); read.mutate(n.id); openPr(n.prId); }}>
            <ListItemText primary={`${n.documentNumber} · ${t(`pr.notificationAction.${n.action}`, { defaultValue: n.action })}`}
              secondary={[n.taskStep ? t(n.resolvedAt ? 'pr.taskResolved' : 'pr.taskOpen') : undefined, fmtDate(n.createdAt), n.reason].filter(Boolean).join(' · ')}
              slotProps={{ primary: { sx: { fontWeight: n.readAt || n.resolvedAt ? 'normal' : 600 } } }} />
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}
