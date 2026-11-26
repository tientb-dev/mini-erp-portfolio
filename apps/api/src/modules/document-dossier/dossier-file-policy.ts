export const DEFAULT_DOSSIER_MAX_FILE_BYTES = 20 * 1024 * 1024;

/** The upload flow uses this policy before creating temporary file metadata. */
export function dossierMaxFileBytes(setting = process.env.DOSSIER_MAX_FILE_BYTES) {
  if (setting === undefined) return DEFAULT_DOSSIER_MAX_FILE_BYTES;
  const bytes = Number(setting);
  if (!/^\d+$/.test(setting) || !Number.isSafeInteger(bytes) || bytes <= 0) {
    throw new Error('DOSSIER_MAX_FILE_BYTES must be a positive integer');
  }
  return bytes;
}
