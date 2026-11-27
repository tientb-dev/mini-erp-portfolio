import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { IconButton, Stack, Tooltip, Typography } from '@mui/material';
import Edit from '@mui/icons-material/EditOutlined';
import Remove from '@mui/icons-material/RemoveCircleOutlineOutlined';
import type { GridColDef } from '@mui/x-data-grid';
import { api, ApiError } from '../../services/api-client';
import { DataTable, FilterToolbar, FormDialog, GridText } from '../../shared/components';
import type { ActionResult } from '../../shared/components/ActionResultDialog';
import { ActionButton } from '../../shared/components/ActionButton';
import { SearchInput } from '../../shared/components/SearchInput';
import { fmtDay } from '../../shared/utils/format';
import { MembershipDialog, MembershipValue } from './MembershipDialog';
import { CheckMark, EmploymentChip } from './UserChips';
import { Membership, PersonRef, personLabel, Ref, refLabel, UserRow } from './users-api';

export interface Member extends PersonRef {
  employmentStatus: 'ACTIVE' | 'INACTIVE'; isPrimary: boolean; startedAt: string; isHead: boolean; jobTitle: Ref; manager: PersonRef | null;
  /** F11: the membership row and its version, sent back for optimistic locking. */ membershipId: number; membershipVersion: number;
}
export const membersKey = (unitId: number) => ['/admin/org-units', 'members', unitId];
export const useMembers = (unitId: number, enabled = true) =>
  useQuery({ queryKey: membersKey(unitId), enabled, queryFn: () => api<Member[]>(`/admin/org-units/${unitId}/members`) });

type Dialog = { add: true } | { edit: Member } | { end: Member };
const asMembership = (unit: Ref, m: Member): Membership => ({ id: m.membershipId, version: m.membershipVersion, orgUnit: unit, jobTitle: m.jobTitle,
  isPrimary: m.isPrimary, manager: m.manager, isHead: m.isHead, startedAt: m.startedAt });

/**
 * Nhân sự of one unit (BA-UI-09): the unit's ACTIVE members, changed through the Membership API with the shared
 * Membership Dialog. The tree, the selected unit and this tab keep their state across changes and refreshes (only the
 * queries are invalidated; nothing remounts).
 */
export function OrgUnitMembers({ unit, canManage, onResult, onChanged }: {
  unit: Ref & { isActive: boolean }; canManage: boolean; onResult: (result: ActionResult) => void; onChanged: () => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const members = useMembers(unit.id);
  const [dialog, setDialog] = useState<Dialog>();
  const [q, setQ] = useState('');
  const needle = q.trim().toLowerCase();
  const rows = (members.data ?? []).filter(m => !needle || m.employeeCode.toLowerCase().includes(needle) || m.fullName.toLowerCase().includes(needle));
  const done = async (title: string, who: PersonRef) => {
    setDialog(undefined);
    await qc.invalidateQueries({ queryKey: ['/admin/org-units'] });
    await qc.invalidateQueries({ queryKey: ['/admin/users'] });
    onChanged();
    onResult({ success: true, title, message: `${personLabel(who)} · ${refLabel(unit)}` });
  };
  const fail = (error: unknown, title: string) => {
    setDialog(undefined);
    void qc.invalidateQueries({ queryKey: membersKey(unit.id) });
    onResult({ success: false, error, title, hint: error instanceof ApiError && error.code === 'VERSION_CONFLICT' ? t('users.conflictHint') : undefined });
  };
  const save = useMutation({
    mutationFn: (value: MembershipValue) => {
      const body = { jobTitleId: value.jobTitle.id, managerUserId: value.manager?.id ?? null, isPrimary: value.isPrimary };
      if (dialog && 'edit' in dialog) {
        return api(`/admin/memberships/${dialog.edit.membershipId}`, { method: 'PUT', body: JSON.stringify({ ...body, version: dialog.edit.membershipVersion }) });
      }
      const employee = value.employee as UserRow;
      return api('/admin/memberships', { method: 'POST', body: JSON.stringify({ ...body, userId: employee.id, orgUnitId: unit.id, version: employee.version }) });
    },
    onSuccess: (_r, value) => done(t(dialog && 'edit' in dialog ? 'users.membershipUpdated' : 'users.membershipAdded'), value.employee ?? (dialog as { edit: Member }).edit),
    onError: error => fail(error, t('users.membershipFailed')),
  });
  const end = useMutation({
    mutationFn: (m: Member) => api(`/admin/memberships/${m.membershipId}/end`, { method: 'POST', body: JSON.stringify({ version: m.membershipVersion }) }),
    onSuccess: (_r, m) => done(t('users.membershipEnded'), m),
    onError: error => fail(error, t('users.membershipEndFailed')),
  });
  // F10: who, then primary unit and head (checks), then title, manager, status, since.
  const columns: GridColDef<Member>[] = [
    { field: 'employeeCode', headerName: t('users.employeeCodeShort'), width: 100,
      renderCell: ({ row, tabIndex }) => <GridText to={`/users/${row.id}`} tabIndex={tabIndex} value={row.employeeCode} /> },
    { field: 'fullName', headerName: t('users.fullName'), minWidth: 160, flex: 1 },
    { field: 'isPrimary', headerName: t('users.primaryUnit'), width: 110, align: 'center', headerAlign: 'center',
      renderCell: ({ row }) => row.isPrimary && <CheckMark label={t('users.primaryUnit')} /> },
    { field: 'isHead', headerName: t('orgUnits.head'), width: 120, align: 'center', headerAlign: 'center',
      renderCell: ({ row }) => row.isHead && <CheckMark label={t('orgUnits.head')} /> },
    { field: 'jobTitle', headerName: t('users.jobTitle'), minWidth: 130, flex: 0.8, valueGetter: (_v, row) => row.jobTitle.name },
    { field: 'manager', headerName: t('users.manager'), minWidth: 160, flex: 0.9, valueGetter: (_v, row) => (row.manager ? personLabel(row.manager) : '—') },
    { field: 'employmentStatus', headerName: t('users.employmentStatus'), width: 140, renderCell: ({ row }) => <EmploymentChip status={row.employmentStatus} /> },
    { field: 'startedAt', headerName: t('users.startedAt'), width: 100, valueGetter: (_v, row) => fmtDay(row.startedAt) },
  ];
  if (canManage) columns.push({ field: 'actions', headerName: t('common.actions'), width: 90, sortable: false, align: 'center',
    renderCell: ({ row }) => <Stack direction="row" sx={{ alignItems: 'center', height: '100%' }}>
      <Tooltip title={t('users.editMembership')}><IconButton size="small" color="primary"
        aria-label={`${t('users.editMembership')} ${row.employeeCode}`} onClick={() => setDialog({ edit: row })}><Edit fontSize="small" /></IconButton></Tooltip>
      {/* BA-N-05: the head's membership ends only after the unit's head changes. */}
      <Tooltip title={row.isHead ? t('users.endBlockedHead') : t('users.endMembership')}><span><IconButton size="small" color="error" disabled={row.isHead}
        aria-label={`${t('users.endMembership')} ${row.employeeCode}`} onClick={() => setDialog({ end: row })}><Remove fontSize="small" /></IconButton></span></Tooltip>
    </Stack> });
  return (
    <Stack spacing={1.5}>
      <Stack direction="row" sx={{ alignItems: 'flex-end', gap: 1.5, flexWrap: 'wrap' }}>
        <FilterToolbar>
          <SearchInput label={t('common.search')} placeholder={t('users.personSearch')} value={q} onChange={setQ} sx={{ flex: '0 1 320px', minWidth: 220 }} />
        </FilterToolbar>
        <span style={{ flex: 1 }} />
        {canManage && <Tooltip title={unit.isActive ? '' : t('users.unitInactive')}><span>
          <ActionButton action="add" variant="outlined" disabled={!unit.isActive} onClick={() => setDialog({ add: true })}>{t('users.addMember')}</ActionButton>
        </span></Tooltip>}
      </Stack>
      <DataTable rows={rows} columns={columns} loading={members.isFetching} error={members.error}
        emptyHint={t(needle ? 'users.noPersonMatch' : 'orgUnits.membersPending')} />
      {dialog && !('end' in dialog) && <MembershipDialog direct orgUnit={unit} employee={'edit' in dialog ? dialog.edit : undefined}
        initial={'edit' in dialog ? asMembership(unit, dialog.edit) : undefined} pending={save.isPending} error={null}
        onClose={() => setDialog(undefined)} onSubmit={value => save.mutate(value)} />}
      {dialog && 'end' in dialog && <FormDialog title={t('users.endMembershipTitle')} description={`${personLabel(dialog.end)} · ${refLabel(unit)}`}
        submitLabel={t('users.endMembership')} submitAction="void" pending={end.isPending} canSubmit error={null}
        onClose={() => setDialog(undefined)} onSubmit={() => end.mutate(dialog.end)}>
        <Stack spacing={1}>
          <Typography variant="body2">{t('users.endMembershipEffect')}</Typography>
          {dialog.end.isPrimary && <Typography variant="body2" color="warning.main">{t('users.endPrimaryWarning')}</Typography>}
        </Stack>
      </FormDialog>}
    </Stack>
  );
}
