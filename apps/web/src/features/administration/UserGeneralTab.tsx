import type { RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Alert, Checkbox, FormControlLabel, TextField, Typography } from '@mui/material';
import type { ActionResult } from '../../shared/components/ActionResultDialog';
import { DocumentFormCell, DocumentFormGrid } from '../../shared/components/DocumentFormGrid';
import { ReadOnlyField } from '../../shared/components/ReadOnlyField';
import { PasswordField } from '../identity';
import { AccountPanel } from './UserAccount';
import type { Membership, Ref, UserDetail } from './users-api';

export interface Draft {
  employeeCode: string; fullName: string; email: string; phone: string;
  /** Create only: also create the initial account in the same transaction (F-OA0-06). */ withAccount: boolean; username: string; password: string;
  memberships: Membership[]; roles: Ref[]; warehouses: Ref[];
}
export type Field = 'employeeCode' | 'fullName' | 'email' | 'phone' | 'username' | 'password';

// Same rules as the API DTOs (user-admin.ts) and the shared password policy (BA-USR-05).
const CODE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,49}$/;
const USERNAME = /^[A-Za-z0-9][A-Za-z0-9_.@-]{0,99}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE = /^[0-9+().\s-]*$/;
export const PASSWORD_MIN = 12;

export function validate(v: Draft, creating: boolean, t: TFunction): Partial<Record<Field, string>> {
  const errors: Partial<Record<Field, string>> = {};
  if (creating && !v.employeeCode.trim()) errors.employeeCode = t('users.employeeCodeRequired');
  else if (creating && !CODE.test(v.employeeCode.trim())) errors.employeeCode = t('jobTitles.codeFormat');
  if (!v.fullName.trim()) errors.fullName = t('users.fullNameRequired');
  if (v.email.trim() && !EMAIL.test(v.email.trim())) errors.email = t('users.emailFormat');
  if (!PHONE.test(v.phone)) errors.phone = t('users.phoneFormat');
  if (creating && v.withAccount) {
    if (!USERNAME.test(v.username.trim())) errors.username = t('users.usernameFormat');
    if (v.password.length < PASSWORD_MIN || v.password.length > 256) errors.password = t('account.passwordLength', { min: PASSWORD_MIN });
  }
  return errors;
}

export function GeneralTab({ value, user, editing, creating, self, canManage, errorOf, refs, onTouch, onChange, onResult, onChanged }: {
  value: Draft; user?: UserDetail; editing: boolean; creating: boolean; self: boolean; canManage: boolean;
  errorOf: (field: Field) => string | undefined; refs: Record<Field, RefObject<HTMLInputElement | null>>; onTouch: (field: Field) => void;
  onChange: (changes: Partial<Draft>) => void; onResult: (result: ActionResult) => void; onChanged: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const input = (field: Field, span: number, props: { required?: boolean; type?: string; helperText?: string; max: number }) => {
    const error = errorOf(field);
    return <DocumentFormCell span={span}>
      <TextField fullWidth size="small" label={t(`users.${field}`)} value={value[field]} required={props.required} type={props.type}
        error={Boolean(error)} helperText={error ?? props.helperText} inputRef={refs[field]} onBlur={() => onTouch(field)}
        onChange={e => onChange({ [field]: e.target.value })} slotProps={{ htmlInput: { maxLength: props.max }, inputLabel: { shrink: true } }} />
    </DocumentFormCell>;
  };
  const read = (field: Field, span: number, helperText?: string) =>
    <DocumentFormCell span={span}><ReadOnlyField label={t(`users.${field}`)} value={value[field]} helperText={helperText} /></DocumentFormCell>;
  return (
    <DocumentFormGrid>
      {creating ? input('employeeCode', 4, { required: true, helperText: t('users.employeeCodeHint'), max: 50 })
        : read('employeeCode', 4, editing ? t('users.employeeCodeLocked') : undefined)}
      {/* BA-USR-09: an administrator changes only their own email and phone here. */}
      {editing && !self ? input('fullName', 8, { required: true, max: 200 }) : read('fullName', 8, editing && self ? t('users.selfNameLocked') : undefined)}
      {editing ? input('email', 6, { max: 200 }) : read('email', 6)}
      {editing ? input('phone', 6, { max: 50 }) : read('phone', 6)}
      <DocumentFormCell span={12}>
        <Typography variant="subtitle2" sx={{ mt: 1.5, mb: 0.5 }}>{t('users.accountSection')}</Typography>
      </DocumentFormCell>
      {creating ? <>
        <DocumentFormCell span={12}>
          <FormControlLabel label={t('users.withAccount')} control={<Checkbox checked={value.withAccount}
            onChange={e => onChange({ withAccount: e.target.checked })} />} />
          {!value.withAccount && <Typography variant="body2" color="text.secondary">{t('users.withoutAccountHint')}</Typography>}
        </DocumentFormCell>
        {value.withAccount && <>
          {input('username', 6, { required: true, helperText: t('users.usernameHint'), max: 100 })}
          <DocumentFormCell span={6}>
            {/* F08: the OA1.2 password field (show/hide); the policy shows as help until a rule fails. */}
            <PasswordField fullWidth size="small" autoComplete="new-password" label={t('users.password')} value={value.password} inputRef={refs.password}
              onBlur={() => onTouch('password')} onChange={password => onChange({ password })} error={errorOf('password')}
              helper={t('users.initialPasswordHint', { min: PASSWORD_MIN })} />
          </DocumentFormCell>
        </>}
      </> : user && <DocumentFormCell span={12}>
        {editing && <Alert severity="info" sx={{ mb: 1.5 }}>{t('users.accountWhileEditing')}</Alert>}
        <AccountPanel user={user} actions={canManage && !editing && !self} self={self} onResult={onResult} onChanged={onChanged} />
      </DocumentFormCell>}
    </DocumentFormGrid>
  );
}
