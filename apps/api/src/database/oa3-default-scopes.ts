/** Scoped grants for seeded business roles (OA3 §7.1). ADMIN is maintained by catalog triggers. */
export const OA3_DEFAULT_SCOPES: Record<string, Record<string, string[]>> = {
  SALES: {
    'SALES_CONTRACT.VIEW': ['CREATOR', 'RESPONSIBLE'], 'SALES_CONTRACT.CREATE': ['CREATOR', 'RESPONSIBLE'],
    'PR.VIEW': ['CREATOR', 'RESPONSIBLE', 'ASSIGNED'], 'PR.CREATE': ['CREATOR', 'RESPONSIBLE'],
  },
  PM: {
    'SALES_CONTRACT.VIEW': ['RESPONSIBLE'],
    'PR.VIEW': ['CREATOR', 'RESPONSIBLE', 'ASSIGNED'], 'PR.CREATE': ['CREATOR', 'RESPONSIBLE'],
  },
  PURCHASING: { 'PR.VIEW': ['ALL'], 'PR.RECEIVE': ['ASSIGNED'] },
  SALES_HEAD: { 'PR.VIEW': ['ASSIGNED'], 'PR.APPROVE': ['ASSIGNED'] },
  PM_HEAD: { 'PR.VIEW': ['ASSIGNED'], 'PR.APPROVE': ['ASSIGNED'] },
  WAREHOUSE_MANAGER: {},
};
