import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Checkbox, FormControlLabel, MenuItem, TextField, Typography } from '@mui/material';
import { FormDialog } from '../../shared/components';
import { DocumentFormCell, DocumentFormGrid } from '../../shared/components/DocumentFormGrid';
import { ReadOnlyField } from '../../shared/components/ReadOnlyField';
import { ServerAutocomplete } from './ServerAutocomplete';
import { Membership, PersonRef, personLabel, Ref, refLabel, useOrgTree, UserRow } from './users-api';

export interface MembershipValue { employee?: UserRow | PersonRef; orgUnit: Ref; jobTitle: Ref; manager: PersonRef | null; isPrimary: boolean }

/** Server-side search over ACTIVE employees (Common List API of Người dùng); `exclude` hides one person (no self-manager). */
export function PersonAutocomplete({ label, value, onChange, exclude, required, error, disabled }: {
  label: string; value: PersonRef | UserRow | null; onChange: (value: UserRow | null) => void; exclude?: number; required?: boolean; error?: string; disabled?: boolean;
}) {
  const { t } = useTranslation();
  return <ServerAutocomplete<UserRow> path="/admin/users" fixed={{ employmentStatus: 'ACTIVE' }} sort="employeeCode" label={label}
    getLabel={personLabel} value={value as UserRow | null} onChange={onChange} exclude={exclude} required={required} error={error}
    disabled={disabled} placeholder={t('users.personSearch')} />;
}

/**
 * One membership (BA-UI-09): the same dialog on the User page (Áp dụng: applied to the local draft, saved with the User)
 * and on the unit's Nhân sự tab (`direct`: sent to the Membership API at once). The caller fixes the employee or the unit.
 * `currentPrimary` names the unit that becomes secondary when this one is marked primary.
 */
export function MembershipDialog({ employee, orgUnit, initial, takenUnitIds = [], forcePrimary, currentPrimary, direct, pending, error, onClose, onSubmit }: {
  employee?: PersonRef; orgUnit?: Ref; initial?: Membership; takenUnitIds?: number[]; forcePrimary?: boolean; currentPrimary?: Ref | null;
  direct?: boolean; pending: boolean; error: unknown; onClose: () => void; onSubmit: (value: MembershipValue) => void;
}) {
  const { t } = useTranslation();
  const tree = useOrgTree();
  const [person, setPerson] = useState<UserRow | PersonRef | null>(employee ?? null);
  const [unitId, setUnitId] = useState<number | ''>(initial?.orgUnit.id ?? orgUnit?.id ?? '');
  const [title, setTitle] = useState<Ref | null>(initial?.jobTitle ?? null);
  const [manager, setManager] = useState<PersonRef | null>(initial?.manager ?? null);
  const [primaryChoice, setPrimary] = useState(initial?.isPrimary ?? false);
  const [submitted, setSubmitted] = useState(false);
  // The first unit of an employee is the primary one (BA-ORG-04); a picked employee without a primary unit counts too.
  const pickedPrimary = person && 'primaryOrgUnit' in person ? person.primaryOrgUnit : undefined;
  const mustBePrimary = !initial && (Boolean(forcePrimary) || pickedPrimary === null);
  const isPrimary = primaryChoice || mustBePrimary;
  const fixedUnit = initial?.orgUnit ?? orgUnit;
  const units = (tree.data ?? []).filter(n => n.isActive && !takenUnitIds.includes(n.id));
  const unit = fixedUnit ?? units.find(n => n.id === unitId);
  const oldPrimary = currentPrimary !== undefined ? currentPrimary : pickedPrimary;
  const movesPrimary = isPrimary && !mustBePrimary && !initial?.isPrimary && oldPrimary !== null;
  const issues = {
    person: !person ? t('users.employeeRequired') : undefined,
    unit: !unit ? t('users.orgUnitRequired') : undefined,
    title: !title ? t('users.jobTitleRequired') : undefined,
  };
  const shown = (key: keyof typeof issues) => (submitted ? issues[key] : undefined);
  const dirty = person?.id !== employee?.id || unitId !== (initial?.orgUnit.id ?? orgUnit?.id ?? '') || title?.id !== initial?.jobTitle.id
    || manager?.id !== initial?.manager?.id || primaryChoice !== (initial?.isPrimary ?? false);
  const submit = () => {
    setSubmitted(true);
    if (issues.person || issues.unit || issues.title) return;
    onSubmit({ employee: person ?? undefined, orgUnit: { id: unit!.id, code: unit!.code, name: unit!.name }, jobTitle: title!, manager, isPrimary });
  };
  const heading = initial ? 'users.editMembership' : employee ? 'users.addMembership' : 'users.addMember';
  const submitKey = direct ? 'users.saveMembership' : initial ? 'users.applyMembership' : 'users.addMembership';
  const hint = mustBePrimary ? 'users.primaryFirst' : initial?.isPrimary ? 'users.primaryCurrent' : 'users.primaryHint';
  return (
    <FormDialog pageGuardsNavigation title={t(heading)} width={720}
      // The unit already shows as a read-only field, so only the employee is named here (F04: no repeated unit).
      description={employee ? personLabel(employee) : undefined}
      submitLabel={t(submitKey)} submitAction={direct ? 'save' : initial ? 'confirm' : 'add'}
      dirty={dirty} pending={pending} error={error} canSubmit onClose={onClose} onSubmit={submit}>
      <DocumentFormGrid>
        {!employee && <DocumentFormCell span={12}>
          <PersonAutocomplete label={t('users.employee')} value={person} onChange={setPerson} required error={shown('person')} disabled={pending} />
        </DocumentFormCell>}
        <DocumentFormCell span={6}>{fixedUnit ? <ReadOnlyField label={t('users.orgUnit')} value={refLabel(fixedUnit)} />
          : <TextField select fullWidth size="small" required label={t('users.orgUnit')} value={unitId} disabled={pending}
              error={Boolean(shown('unit'))} helperText={shown('unit')} onChange={e => setUnitId(Number(e.target.value))}>
              {units.map(n => <MenuItem key={n.id} value={n.id}>{refLabel(n)}</MenuItem>)}
            </TextField>}</DocumentFormCell>
        <DocumentFormCell span={6}>
          {/* Active titles only for a new choice (JOB_TITLE_INACTIVE on the server); a stored title stays as the value. */}
          <ServerAutocomplete<Ref> path="/admin/job-titles" fixed={{ status: 'true' }} sort="code" label={t('users.jobTitle')} getLabel={refLabel}
            value={title} onChange={setTitle} required error={shown('title')} disabled={pending} placeholder={t('searchFields.codeOrName')} />
        </DocumentFormCell>
        <DocumentFormCell span={12}>
          <PersonAutocomplete label={t('users.manager')} value={manager} onChange={setManager} exclude={person?.id} disabled={pending} />
        </DocumentFormCell>
        <DocumentFormCell span={12}>
          {/* Exactly one primary unit (BA-ORG-04): the primary moves by marking another unit, never by unmarking this one. */}
          <FormControlLabel label={t('users.primaryUnit')} control={<Checkbox checked={isPrimary} disabled={pending || mustBePrimary || Boolean(initial?.isPrimary)}
            onChange={e => setPrimary(e.target.checked)} />} />
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{t(hint)}</Typography>
          {movesPrimary && <Alert severity="info" sx={{ mt: 1 }}>
            {oldPrimary ? t('users.primaryMoves', { unit: refLabel(oldPrimary) }) : t('users.primaryMovesUnknown')}
          </Alert>}
        </DocumentFormCell>
      </DocumentFormGrid>
    </FormDialog>
  );
}
