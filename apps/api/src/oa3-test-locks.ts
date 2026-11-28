import { DataSource } from 'typeorm';

export async function holdLock(ds: DataSource, sql: string, params: unknown[] = []) {
  const runner = ds.createQueryRunner();
  try {
    await runner.startTransaction();
    const [{ pid }] = await runner.query('SELECT pg_backend_pid() AS pid');
    await runner.query(sql, params);
    return {
      pid: pid as number,
      release: async () => {
        try { await runner.rollbackTransaction(); } finally { await runner.release(); }
      },
    };
  } catch (error) {
    try {
      if (runner.isTransactionActive) await runner.rollbackTransaction();
    } finally { await runner.release(); }
    throw error;
  }
}

export async function waitForBlockedBackend(
  ds: DataSource, blocker: number, kind: 'grant-read' | 'grant-write' | 'sales_contracts' | 'purchase_requisitions',
): Promise<number> {
  for (let i = 0; i < 250; i++) {
    const rows: { pid: number }[] = await ds.query(`
      SELECT waiting.pid FROM pg_locks waiting
      WHERE NOT waiting.granted AND $1::int = ANY(pg_blocking_pids(waiting.pid)) AND (
        ($2 IN ('sales_contracts', 'purchase_requisitions') AND waiting.locktype = 'transactionid' AND waiting.mode = 'ShareLock'
          AND EXISTS (SELECT 1 FROM pg_locks owner WHERE owner.pid = $1 AND owner.granted
            AND owner.locktype = 'transactionid' AND owner.transactionid = waiting.transactionid)
          AND EXISTS (SELECT 1 FROM pg_locks row_lock WHERE row_lock.pid = waiting.pid AND row_lock.granted
            AND row_lock.locktype = 'relation' AND row_lock.relation = to_regclass($2) AND row_lock.mode = 'RowShareLock')
          AND EXISTS (SELECT 1 FROM pg_locks gate WHERE gate.pid = waiting.pid AND gate.granted
            AND gate.locktype = 'advisory' AND gate.mode = 'ShareLock'
            AND gate.classid::bigint = ((hashtext('grants')::bigint >> 32) & 4294967295)
            AND gate.objid::bigint = (hashtext('grants')::bigint & 4294967295) AND gate.objsubid = 1))
        OR ($2 IN ('grant-read', 'grant-write') AND waiting.locktype = 'advisory'
          AND waiting.classid::bigint = ((hashtext('grants')::bigint >> 32) & 4294967295)
          AND waiting.objid::bigint = (hashtext('grants')::bigint & 4294967295) AND waiting.objsubid = 1
          AND waiting.mode = CASE WHEN $2 = 'grant-read' THEN 'ShareLock' ELSE 'ExclusiveLock' END
          AND NOT EXISTS (SELECT 1 FROM pg_locks held WHERE held.pid = waiting.pid AND held.granted
            AND (held.database, held.classid, held.objid, held.objsubid) =
                (waiting.database, waiting.classid, waiting.objid, waiting.objsubid)))
      )`, [blocker, kind]);
    if (rows.length === 1) return rows[0].pid;
    if (rows.length > 1) throw new Error(`Ambiguous ${kind} wait behind backend ${blocker}`);
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error(`No ${kind} wait behind backend ${blocker}`);
}
