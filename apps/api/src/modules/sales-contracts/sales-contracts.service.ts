import { ForbiddenException, HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import type { CurrentUser } from '../identity/auth';
import { ProductUsage } from '../master-data/product-usage';
import { grantRole } from '../identity/authorization';
import { DataScope, ScopeSource, assertCanAct, assertCanRead, canAccessDraft, hasPermission, inScope, loadDataScope, matchesDraft, ownerOrgUnit, scopeFilter } from '../identity/data-scope';
import * as wf from '../workflow/workflow';
import { BusinessError } from '../workflow/workflow';

import { CatalogFacade } from '../master-data/catalog.facade';

export interface ScLineInput { id?: number; productId?: number | null; temporaryProductId?: number | null; itemDescription?: string | null; itemCode: string; itemName: string; unitOfMeasureId: number; quantity: number }

/** HĐ list filters/sort/paging; all optional, so old callers (pickers) keep getting every contract as an array. */
export interface ScListQuery {
  q?: string; status?: string; responsibleSalesUserId?: number; customerId?: number;
  sort?: 'createdAt' | 'documentNumber'; order?: 'asc' | 'desc'; page?: number; pageSize?: number;
}

const VIEW = 'SALES_CONTRACT.VIEW';
const CREATE = 'SALES_CONTRACT.CREATE';

interface ScActionScope {
  status: string;
  createdBy: number;
  ownerOrgUnitId: number | null;
  responsibleSalesUserId: number | null;
  responsiblePmUserId: number | null;
}
/** HĐ scope columns (§5.3): creator, responsible Sales/PM, owner unit. */
const SC_SOURCE: ScopeSource = { from: 'sales_contracts s', id: 's.id',
  cols: { creator: 's.created_by', responsible: ['s.responsible_sales_user_id', 's.responsible_pm_user_id'], orgUnit: 's.owner_org_unit_id' } };

/** Read boundary (OA3.2 F02): scope and data from one snapshot. */
export const readSnapshot = <T>(ds: DataSource, run: (m: EntityManager) => Promise<T>) =>
  ds.transaction('REPEATABLE READ', async (m) => { await m.query('SET TRANSACTION READ ONLY'); return run(m); });

/**
 * Facade for other modules (Procurement, Outbound). Runs inside the caller's transaction.
 * Lock order: HĐ line first (ARCHITECTURE §2.1a).
 */
export class SalesContractFacade {
  static canRead(m: EntityManager, scope: DataScope, id: number) {
    return inScope(m, scope, VIEW, SC_SOURCE, id);
  }

  /** Predicate for projections joined to the owning contract as s. */
  static readFilter(scope: DataScope, first: number) {
    return scopeFilter(scope, VIEW, SC_SOURCE.cols, first);
  }

  static assertReadable(m: EntityManager, scope: DataScope, id: number) {
    return assertCanRead(m, scope, VIEW, SC_SOURCE, id);
  }

  static async lockReadable(m: EntityManager, scope: DataScope, ids: number[]) {
    await m.query('SELECT id FROM sales_contracts WHERE id = ANY($1) ORDER BY id FOR SHARE', [ids]);
    for (const id of new Set(ids)) await this.assertReadable(m, scope, id);
  }

  /** PR source picker: responsible Sales/PM invariant plus SALES_CONTRACT.VIEW scope (§7). Call inside `readSnapshot`. */
  static async prOptions(m: EntityManager, userId: number, q: string, page: number) {
    const f = scopeFilter(await loadDataScope(m, userId), VIEW, SC_SOURCE.cols, 4);
    if (!f) return [];
    return m.query(`SELECT s.id, s.document_number AS "documentNumber", c.name AS "customerName",
      s.responsible_sales_user_id AS "responsibleSalesUserId", s.responsible_pm_user_id AS "responsiblePmUserId"
      FROM sales_contracts s JOIN customers c ON c.id = s.customer_id
      WHERE s.status = 'ACTIVE' AND $1 IN (s.responsible_sales_user_id, s.responsible_pm_user_id)
        AND (strpos(lower(s.document_number), lower($2)) > 0 OR strpos(lower(c.name), lower($2)) > 0) AND ${f.sql}
      ORDER BY s.document_number DESC, s.id DESC LIMIT 25 OFFSET $3`, [userId, q.trim(), (page - 1) * 25, ...f.params]);
  }

  /** Locks HĐ lines (id order) of an ACTIVE contract; throws if any line is missing or the contract is not ACTIVE. */
  static async lockActiveLines(m: EntityManager, salesContractId: number, lineIds: number[]): Promise<Map<number, { quantity: string }>> {
    const [sc] = await m.query(`SELECT status FROM sales_contracts WHERE id = $1 FOR SHARE`, [salesContractId]);
    if (!sc) throw new NotFoundException('Sales contract not found');
    if (sc.status !== 'ACTIVE') throw new BusinessError('SALES_CONTRACT_NOT_ACTIVE', 'Only ACTIVE sales contracts can be referenced');
    const ids = [...new Set(lineIds)].sort((a, b) => a - b);
    const rows: { id: number; quantity: string }[] = await m.query(
      `SELECT id, quantity FROM sales_contract_lines WHERE sales_contract_id = $1 AND id = ANY($2) ORDER BY id FOR UPDATE`,
      [salesContractId, ids],
    );
    if (rows.length !== ids.length) throw new BusinessError('SALES_CONTRACT_LINE_MISMATCH', 'Every line must belong to the selected sales contract');
    return new Map(rows.map((r) => [r.id, r]));
  }

  /**
   * Responsible sales per contract, read FOR SHARE so it cannot change while the caller's transaction uses it
   * (it is locked once ACTIVE anyway, CT17). Throws when a contract has none (legacy data, runbook PR 1).
   */
  static async responsibleSales(m: EntityManager, salesContractIds: number[]): Promise<Map<number, number>> {
    const ids = [...new Set(salesContractIds)].sort((a, b) => a - b);
    const rows: { id: number; responsible_sales_user_id: number | null }[] = await m.query(
      `SELECT id, responsible_sales_user_id FROM sales_contracts WHERE id = ANY($1) ORDER BY id FOR SHARE`,
      [ids],
    );
    if (rows.some(row => row.responsible_sales_user_id === null)) {
      throw new BusinessError('SOURCE_RESPONSIBLE_SALES_MISSING', 'A stock source has no responsible sales', HttpStatus.CONFLICT);
    }
    return new Map(rows.map((r) => [r.id, r.responsible_sales_user_id!]));
  }

  /** A contract referenced as a stock source (B/D), read FOR SHARE: status and responsible Sales. */
  static async sourceContract(m: EntityManager, id: number, lock = true): Promise<{ status: string; responsibleSalesUserId: number | null; responsiblePmUserId: number | null } | undefined> {
    const [r] = await m.query(`SELECT status, responsible_sales_user_id AS "responsibleSalesUserId", responsible_pm_user_id AS "responsiblePmUserId" FROM sales_contracts WHERE id = $1${lock ? ' FOR SHARE' : ''}`, [id]);
    return r;
  }

  static async assignResponsiblePm(m: EntityManager, scope: DataScope, contractId: number, userId: number) {
    if (!hasPermission(scope, 'PR.CONFIGURE')) throw new ForbiddenException();
    await m.query('SELECT id FROM sales_contracts WHERE id = $1 FOR UPDATE', [contractId]);
    await this.assertReadable(m, scope, contractId);
    if (!(await grantRole(m, userId, 'PR.CREATE'))) throw new BusinessError('PR_PM_NOT_ELIGIBLE', 'Select an active PM');
    const [, updated] = await m.query(`UPDATE sales_contracts SET responsible_pm_user_id = $2,
      version = version + 1, updated_at = now() WHERE id = $1`, [contractId, userId]);
    if (!updated) throw new NotFoundException();
  }

  /** Number and status of contracts, for pickers. */
  static async summaries(m: EntityManager, scope: DataScope, ids: number[]): Promise<Map<number, { documentNumber: string; status: string }>> {
    const filter = scopeFilter(scope, VIEW, SC_SOURCE.cols, 2);
    if (!filter) return new Map<number, { documentNumber: string; status: string }>();
    const rows: { id: number; documentNumber: string; status: string }[] = await m.query(
      `SELECT id, document_number AS "documentNumber", status FROM sales_contracts s WHERE id = ANY($1) AND ${filter.sql}`, [ids, ...filter.params]);
    return new Map(rows.map((r) => [r.id, r]));
  }

  /** Line + product pairs that Sales has not APPROVED for delivery (03 §9.2). */
  static async unapprovedProducts(m: EntityManager, pairs: { salesContractLineId: number; productId: number }[]): Promise<typeof pairs> {
    if (!pairs.length) return [];
    return m.query(
      `SELECT p.line AS "salesContractLineId", p.product AS "productId"
         FROM unnest($1::int[], $2::int[]) AS p(line, product)
        WHERE NOT EXISTS (SELECT 1 FROM sales_contract_line_products x
                           WHERE x.sales_contract_line_id = p.line AND x.product_id = p.product AND x.status = 'APPROVED')`,
      [pairs.map((p) => p.salesContractLineId), pairs.map((p) => p.productId)],
    );
  }
}

/** HĐ (DRAFT/ACTIVE/CANCELED, no approval workflow) and deliverable products per line (ADR-0009). */
@Injectable()
export class SalesContractsService {
  constructor(private readonly ds: DataSource) {}

  /** Users who may be the responsible sales: active and allowed to manage HĐ (SALES_CONTRACT.CREATE, 04 §2). */
  responsibleSalesCandidates(m: EntityManager = this.ds.manager): Promise<{ id: number; username: string; fullName: string }[]> {
    return wf.usersWithPermission(m, 'SALES_CONTRACT.CREATE', 0);
  }

  private async assertResponsibleSales(m: EntityManager, userId: number | null) {
    if (userId === null) return;
    if (!(await this.responsibleSalesCandidates(m)).some((u) => u.id === userId)) {
      throw new BusinessError('RESPONSIBLE_SALES_INVALID', 'The responsible sales must be an active user allowed to manage sales contracts');
    }
  }

  create(user: CurrentUser, customerId: number, responsibleSalesUserId: number | null, lines: ScLineInput[], ownerOrgUnitId?: number | null) {
    return this.ds.transaction(async (m) => {
      const s = await loadDataScope(m, user.id, true);
      const owner = await ownerOrgUnit(m, user.id, ownerOrgUnitId);
      // F-OA0-03: CREATE and VIEW scope on the projected contract.
      if (!canAccessDraft(s, VIEW, CREATE, { creatorId: user.id, responsibleIds: [responsibleSalesUserId], orgUnitId: owner })) {
        throw new ForbiddenException(`Missing permission: ${CREATE}`);
      }
      await CatalogFacade.assertActive(m, 'customer', customerId);
      await this.assertResponsibleSales(m, responsibleSalesUserId);
      const number = await wf.nextDocumentNumber(m, 'SC');
      const [sc] = await m.query(
        `INSERT INTO sales_contracts (document_number, customer_id, responsible_sales_user_id, created_by, owner_org_unit_id) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [number, customerId, responsibleSalesUserId, user.id, owner],
      );
      for (const l of lines) await this.insertLine(m, sc.id, l);
      return { id: sc.id as number, documentNumber: number };
    });
  }

  /**
   * Sales edits a DRAFT contract: customer and lines (03 §9.1). Lines with `id` are updated in place so their ids
   * (product proposals) stay valid; new lines are inserted; omitted lines are deleted unless still referenced.
   * ACTIVE contracts are locked; PR/GIR only reference ACTIVE ones, so a DRAFT is never referenced by them.
   */
  /** `responsibleSalesUserId`: undefined keeps the current value, null clears it, a number assigns it (validated). */
  /** `lines`: undefined keeps the lines untouched (header-only edit); an array replaces them as described above. */
  update(user: CurrentUser, id: number, version: number, customerId: number, responsibleSalesUserId: number | null | undefined, lines?: ScLineInput[]) {
    return this.ds.transaction(async (m) => {
      const { s, sc: current } = await this.lockDraft(m, user, id, version);
      if (current.customer_id !== customerId) await CatalogFacade.assertActive(m, 'customer', customerId);
      if (responsibleSalesUserId !== undefined) {
        // Prospective scope: changing the responsible Sales must not leave the actor without VIEW/CREATE scope.
        const after = { creatorId: current.created_by, orgUnitId: current.owner_org_unit_id,
          responsibleIds: [responsibleSalesUserId, current.responsible_pm_user_id] };
        if (!canAccessDraft(s, VIEW, CREATE, after)) {
          throw new BusinessError('SCOPE_WOULD_BE_LOST', 'After this change you would no longer have access to the contract', HttpStatus.FORBIDDEN);
        }
        await this.assertResponsibleSales(m, responsibleSalesUserId);
      }
      if (lines) {
        await wf.deleteOmittedLines(m, 'sales_contract_lines', 'sales_contract_id', id, lines.flatMap((l) => (l.id ? [l.id] : [])));
        for (const l of lines) {
          if (l.id) await this.updateLine(m, id, l.id, l);
          else await this.insertLine(m, id, l);
        }
      }
      await m.query(
        `UPDATE sales_contracts SET customer_id = $2, responsible_sales_user_id = CASE WHEN $5 THEN $4::int ELSE responsible_sales_user_id END,
                version = version + 1, updated_by = $3, updated_at = now() WHERE id = $1`,
        [id, customerId, user.id, responsibleSalesUserId ?? null, responsibleSalesUserId !== undefined],
      );
    });
  }

  /** Adds one line to a DRAFT contract (each line is saved on its own). */
  addLine(user: CurrentUser, id: number, version: number, line: ScLineInput) {
    return this.ds.transaction(async (m) => {
      await this.lockDraft(m, user, id, version);
      const lineId = await this.insertLine(m, id, line);
      await this.touch(m, id, user);
      return { id: lineId };
    });
  }

  /** Edits one line of a DRAFT contract by its id; product proposals keep pointing at the same line. */
  editLine(user: CurrentUser, lineId: number, version: number, line: ScLineInput) {
    return this.ds.transaction(async (m) => {
      const id = await this.lineContract(m, lineId);
      await this.lockDraft(m, user, id, version);
      await this.updateLine(m, id, lineId, line);
      await this.touch(m, id, user);
    });
  }

  /** Deletes one line of a DRAFT contract; a line that still has product proposals is kept (FK → RECORD_IN_USE, no cascade). */
  deleteLine(user: CurrentUser, lineId: number, version: number) {
    return this.ds.transaction(async (m) => {
      const id = await this.lineContract(m, lineId);
      await this.lockDraft(m, user, id, version);
      await m.query(`DELETE FROM sales_contract_lines WHERE id = $1`, [lineId]);
      await this.touch(m, id, user);
    });
  }

  /** Contract of a line; 0 when the line is unknown, so `lockForAction` answers 403 (no VIEW) or 404 like any id. */
  private async lineContract(m: EntityManager, lineId: number): Promise<number> {
    const [l] = await m.query(`SELECT sales_contract_id AS id FROM sales_contract_lines WHERE id = $1`, [lineId]);
    return l?.id ?? 0;
  }

  /**
   * Action boundary (OA3.2 F02): `grants` gate shared before any row lock → contract FOR UPDATE (serializes with
   * activate/cancel and PR/GIR creation, FOR SHARE in lockActiveLines) → VIEW + CREATE scope on the locked row.
   */
  private async lockForAction(m: EntityManager, user: CurrentUser, id: number) {
    const s = await loadDataScope(m, user.id, true);
    const [sc] = await m.query(`SELECT status, version, customer_id, created_by, responsible_sales_user_id, responsible_pm_user_id, owner_org_unit_id
      FROM sales_contracts WHERE id = $1 FOR UPDATE`, [id]);
    await assertCanAct(m, s, VIEW, CREATE, SC_SOURCE, id);
    return { s, sc };
  }

  /** H-01 (F-OA0-07): a DRAFT is handled only by its creator or responsible Sales, on top of permission and scope; no ADMIN bypass. */
  private assertDraftOwner(user: CurrentUser, sc: { created_by: number; responsible_sales_user_id: number | null }) {
    if (sc.created_by !== user.id && sc.responsible_sales_user_id !== user.id) {
      throw new BusinessError('SALES_CONTRACT_NOT_OWNER', 'Only the creator or the responsible sales can change a DRAFT contract', HttpStatus.FORBIDDEN);
    }
  }

  private async lockDraft(m: EntityManager, user: CurrentUser, id: number, version: number) {
    const locked = await this.lockForAction(m, user, id);
    if (locked.sc.status !== 'DRAFT') throw new BusinessError('INVALID_STATUS', 'Only DRAFT sales contracts can be edited', HttpStatus.CONFLICT);
    this.assertDraftOwner(user, locked.sc);
    if (locked.sc.version !== version) throw new BusinessError('STALE_VERSION', 'The document was changed by someone else; reload and retry', HttpStatus.CONFLICT);
    return locked;
  }

  private touch(m: EntityManager, id: number, user: CurrentUser) {
    return m.query(`UPDATE sales_contracts SET version = version + 1, updated_by = $2, updated_at = now() WHERE id = $1`, [id, user.id]);
  }

  private async lineValues(m: EntityManager, line: ScLineInput, existing?: ScLineInput) {
    const keepSource = line.productId === undefined && line.temporaryProductId === undefined;
    const productId = (keepSource ? existing?.productId : line.productId) ?? null;
    const temporaryProductId = (keepSource ? existing?.temporaryProductId : line.temporaryProductId) ?? null;
    if (productId !== null && temporaryProductId !== null) {
      throw new BusinessError('SC_LINE_MULTIPLE_CATALOG_SOURCES', 'A contract line can reference only one catalog item');
    }
    let snapshot = {
      code: line.itemCode,
      name: line.itemName,
      description: line.itemDescription === undefined ? existing?.itemDescription ?? null : line.itemDescription,
      unitOfMeasureId: line.unitOfMeasureId,
    };
    if (productId !== null || temporaryProductId !== null) {
      if (existing && productId === existing.productId && temporaryProductId === existing.temporaryProductId) {
        snapshot = { code: existing.itemCode, name: existing.itemName, description: snapshot.description,
          unitOfMeasureId: productId === null ? line.unitOfMeasureId : existing.unitOfMeasureId };
      } else {
        const item = await CatalogFacade.contractItem(m, productId, temporaryProductId);
        if (!item) throw new BusinessError('SC_LINE_CATALOG_ITEM_NOT_FOUND', 'Catalog item was not found or is inactive');
        snapshot = { ...item, description: line.itemDescription === undefined ? item.description : line.itemDescription, unitOfMeasureId: item.unitOfMeasureId ?? line.unitOfMeasureId };
        if (productId !== null) await ProductUsage.markUsed(m, productId, { stock: false });
      }
    }
    if (existing?.unitOfMeasureId !== snapshot.unitOfMeasureId) await CatalogFacade.assertActive(m, 'uom', snapshot.unitOfMeasureId);
    return [snapshot.code, snapshot.name, snapshot.description, snapshot.unitOfMeasureId, line.quantity, productId, temporaryProductId];
  }

  private async insertLine(m: EntityManager, id: number, line: ScLineInput): Promise<number> {
    const values = await this.lineValues(m, line);
    const [row] = await m.query(
      `INSERT INTO sales_contract_lines
         (sales_contract_id, item_code, item_name, item_description, unit_of_measure_id, quantity, product_id, temporary_product_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`, [id, ...values],
    );
    return row.id;
  }

  private async updateLine(m: EntityManager, id: number, lineId: number, line: ScLineInput) {
    const [existing] = await m.query(
      `SELECT item_code AS "itemCode", item_name AS "itemName", item_description AS "itemDescription",
         unit_of_measure_id AS "unitOfMeasureId", product_id AS "productId", temporary_product_id AS "temporaryProductId"
       FROM sales_contract_lines WHERE id = $1 AND sales_contract_id = $2`, [lineId, id],
    );
    if (!existing) throw new BusinessError('LINE_NOT_EDITABLE', `Line ${lineId} cannot be updated`, HttpStatus.CONFLICT);
    const values = await this.lineValues(m, line, existing);
    wf.assertLineUpdated(await m.query(
      `UPDATE sales_contract_lines SET item_code = $3, item_name = $4, item_description = $5, unit_of_measure_id = $6,
         quantity = $7, product_id = $8, temporary_product_id = $9 WHERE id = $1 AND sales_contract_id = $2`,
      [lineId, id, ...values],
    ), lineId);
  }

  /** DRAFT → ACTIVE; ACTIVE never returns to DRAFT (H2). Requires a responsible sales, which is locked from then on (CT17). */
  activate(user: CurrentUser, id: number) {
    return this.ds.transaction(async (m) => {
      const { sc } = await this.lockForAction(m, user, id);
      if (sc.status !== 'DRAFT') throw new BusinessError('INVALID_STATUS', 'Only DRAFT sales contracts can be activated', HttpStatus.CONFLICT);
      this.assertDraftOwner(user, sc);
      const [{ hasLines }] = await m.query(`SELECT EXISTS (SELECT 1 FROM sales_contract_lines WHERE sales_contract_id = $1) AS "hasLines"`, [id]);
      // Assumption (OPEN-QUESTIONS §3, confirmed by the user for PR #16): activation needs at least one line.
      if (!hasLines) throw new BusinessError('SALES_CONTRACT_NO_LINES', 'Add at least one line before activating the contract');
      if (sc.responsible_sales_user_id === null) throw new BusinessError('RESPONSIBLE_SALES_REQUIRED', 'Assign a responsible sales before activating the contract');
      await m.query(`UPDATE sales_contracts SET status = 'ACTIVE', version = version + 1 WHERE id = $1`, [id]);
    });
  }

  /** Only DRAFT/ACTIVE contracts with no PR/GIR that is not CANCELED (H2, 03 §9.1). */
  cancel(user: CurrentUser, id: number) {
    return this.ds.transaction(async (m) => {
      // FOR UPDATE waits for PR/GIR creation, which holds the contract FOR SHARE (lockActiveLines).
      const { sc } = await this.lockForAction(m, user, id);
      if (sc.status === 'CANCELED') throw new BusinessError('INVALID_STATUS', 'The sales contract is already canceled', HttpStatus.CONFLICT);
      if (sc.status === 'DRAFT') this.assertDraftOwner(user, sc);
      // shortcut: reads Procurement/Outbound tables directly (reverse of the module graph) until they expose a usage count.
      const [ref] = await m.query(
        `SELECT 1 FROM purchase_requisitions WHERE sales_contract_id = $1 AND approval_status <> 'CANCELED'
         UNION ALL SELECT 1 FROM goods_issue_requests WHERE sales_contract_id = $1 AND approval_status <> 'CANCELED' LIMIT 1`,
        [id],
      );
      if (ref) throw new BusinessError('SALES_CONTRACT_IN_USE', 'The contract is referenced by a PR or GIR that is not canceled', HttpStatus.CONFLICT);
      await m.query(`UPDATE sales_contracts SET status = 'CANCELED' WHERE id = $1`, [id]);
    });
  }

  /** Server-side search/filter/sort; with `page` it returns `{ items, total }`, otherwise the plain array (pickers). */
  list(user: CurrentUser, f: ScListQuery = {}) {
    return readSnapshot(this.ds, (m) => this.listIn(m, user, f));
  }

  /** One scope load; items and total share the same predicate and snapshot (F02). */
  private async listIn(m: EntityManager, user: CurrentUser, f: ScListQuery) {
    const where: string[] = [];
    const params: unknown[] = [];
    const access = await loadDataScope(m, user.id);
    const scope = scopeFilter(access, VIEW, SC_SOURCE.cols, 1);
    if (!scope) return f.page ? { items: [], total: 0 } : [];
    where.push(scope.sql);
    params.push(...scope.params);
    const add = (sql: (n: string) => string, v: unknown) => { params.push(v); where.push(sql(`$${params.length}`)); };
    // strpos instead of ILIKE: no wildcard escaping needed for user input.
    if (f.q?.trim()) add((n) => `(strpos(lower(s.document_number), lower(${n})) > 0 OR strpos(lower(c.name), lower(${n})) > 0)`, f.q.trim());
    if (f.status) add((n) => `s.status = ${n}`, f.status);
    if (f.responsibleSalesUserId) add((n) => `s.responsible_sales_user_id = ${n}`, f.responsibleSalesUserId);
    if (f.customerId) add((n) => `s.customer_id = ${n}`, f.customerId);
    const from = `FROM sales_contracts s JOIN customers c ON c.id = s.customer_id JOIN users u ON u.id = s.created_by
         LEFT JOIN users rs ON rs.id = s.responsible_sales_user_id LEFT JOIN org_units ou ON ou.id = s.owner_org_unit_id ${where.length ? `WHERE ${where.join(' AND ')}` : ''}`;
    const order = `${f.sort === 'documentNumber' ? 's.document_number' : 's.created_at'} ${f.order === 'asc' ? 'ASC' : 'DESC'}, s.id DESC`;
    const size = f.pageSize ?? 25;
    const rows = await m.query<(ScActionScope & Record<string, unknown>)[]>(
      `SELECT s.id, s.document_number AS "documentNumber", s.status, s.version, s.customer_id AS "customerId", c.name AS "customerName", s.created_at AS "createdAt",
              s.created_by AS "createdBy", s.owner_org_unit_id AS "ownerOrgUnitId",
              ou.code || ' · ' || ou.name AS "ownerOrgUnitName",
              u.full_name AS "createdByName", s.responsible_sales_user_id AS "responsibleSalesUserId", rs.full_name AS "responsibleSalesName", s.responsible_pm_user_id AS "responsiblePmUserId",
              (SELECT COUNT(*)::int FROM sales_contract_lines l WHERE l.sales_contract_id = s.id) AS "lineCount",
              (SELECT COUNT(*)::int FROM sales_contract_line_products x JOIN sales_contract_lines l ON l.id = x.sales_contract_line_id
                WHERE l.sales_contract_id = s.id AND x.status = 'PENDING') AS "pendingProposals"
         ${from} ORDER BY ${order} ${f.page ? `LIMIT ${size} OFFSET ${(f.page - 1) * size}` : ''}`,
      params,
    );
    const items = rows.map(({ createdBy, ownerOrgUnitId, ...row }) => ({
      ...row, actionPermissions: this.actionPermissions(access, { ...row, createdBy, ownerOrgUnitId }),
    }));
    if (!f.page) return items;
    const [{ total }] = await m.query(`SELECT COUNT(*)::int AS total ${from}`, params);
    return { items, total };
  }

  private actionPermissions(access: DataScope, sc: ScActionScope) {
    const draftOwner = sc.createdBy === access.userId || sc.responsibleSalesUserId === access.userId;
    return [CREATE, 'SALES_CONTRACT.PROPOSE_PRODUCT', 'SALES_CONTRACT.CONFIRM_PRODUCT'].filter(permission =>
      (permission !== CREATE || sc.status !== 'DRAFT' || draftOwner) && matchesDraft(access, permission, {
        creatorId: sc.createdBy, orgUnitId: sc.ownerOrgUnitId,
        responsibleIds: [sc.responsibleSalesUserId, sc.responsiblePmUserId],
      }));
  }

  get(user: CurrentUser, id: number) {
    return readSnapshot(this.ds, async (m) => {
      const access = await loadDataScope(m, user.id);
      await assertCanRead(m, access, VIEW, SC_SOURCE, id);
      const [sc] = await m.query(
        `SELECT s.id, s.document_number AS "documentNumber", s.status, s.version, s.customer_id AS "customerId",
                c.code AS "customerCode", c.name AS "customerName",
                s.created_by AS "createdBy", u.full_name AS "createdByName", s.created_at AS "createdAt",
                s.responsible_sales_user_id AS "responsibleSalesUserId", rs.full_name AS "responsibleSalesName", s.responsible_pm_user_id AS "responsiblePmUserId",
                s.updated_at AS "updatedAt", (SELECT full_name FROM users WHERE id = s.updated_by) AS "updatedByName",
                s.owner_org_unit_id AS "ownerOrgUnitId", (SELECT code || ' · ' || name FROM org_units WHERE id = s.owner_org_unit_id) AS "ownerOrgUnitName"
           FROM sales_contracts s JOIN customers c ON c.id = s.customer_id JOIN users u ON u.id = s.created_by
           LEFT JOIN users rs ON rs.id = s.responsible_sales_user_id WHERE s.id = $1`,
        [id],
      );
      if (!sc) throw new NotFoundException();
      return { ...sc, actionPermissions: this.actionPermissions(access, sc), lines: await this.linesIn(m, id) };
    });
  }

  /** Lines with confirmed (APPROVED) products and GIR quota usage, for GIR forms. */
  lines(user: CurrentUser, id: number) {
    return readSnapshot(this.ds, async (m) => {
      await assertCanRead(m, await loadDataScope(m, user.id), VIEW, SC_SOURCE, id);
      return this.linesIn(m, id);
    });
  }

  private linesIn(m: EntityManager, id: number) {
    return m.query(
      `SELECT l.id, l.item_code AS "itemCode", l.item_name AS "itemName", l.item_description AS "itemDescription", l.product_id AS "productId",
              l.temporary_product_id AS "temporaryProductId", l.unit_of_measure_id AS "unitOfMeasureId", uom.name AS "uomName",
              uom.code AS "uomCode", l.quantity,
              COALESCE((SELECT json_agg(json_build_object('id', x.id, 'productId', p.id, 'partNumber', p.part_number, 'name', p.name, 'isActive', p.is_active,
                                                          'status', x.status, 'reason', x.reason, 'decisionNote', x.decision_note,
                                                          'proposedByName', pu.full_name, 'decidedByName', du.full_name, 'decidedAt', x.decided_at) ORDER BY x.id)
                          FROM sales_contract_line_products x JOIN products p ON p.id = x.product_id
                          JOIN users pu ON pu.id = x.proposed_by LEFT JOIN users du ON du.id = x.decided_by
                         WHERE x.sales_contract_line_id = l.id), '[]') AS products
         FROM sales_contract_lines l JOIN units_of_measure uom ON uom.id = l.unit_of_measure_id
        WHERE l.sales_contract_id = $1 ORDER BY l.id`,
      [id],
    );
  }

  /** PM proposes a product (incl. substitutes) for a HĐ line, with a reason (03 §9.2). */
  propose(user: CurrentUser, salesContractLineId: number, productId: number, reason: string) {
    return this.ds.transaction(async (m) => {
      const scope = await loadDataScope(m, user.id, true);
      if (!hasPermission(scope, VIEW) || !hasPermission(scope, 'SALES_CONTRACT.PROPOSE_PRODUCT')) throw new ForbiddenException();
      const [line] = await m.query(
        `SELECT s.id, s.status FROM sales_contract_lines l JOIN sales_contracts s ON s.id = l.sales_contract_id WHERE l.id = $1 FOR SHARE OF s`,
        [salesContractLineId],
      );
      if (!line) throw new NotFoundException();
      await assertCanAct(m, scope, VIEW, 'SALES_CONTRACT.PROPOSE_PRODUCT', SC_SOURCE, line.id);
      if (line.status === 'CANCELED') throw new BusinessError('SALES_CONTRACT_CANCELED', 'The sales contract is canceled');
      const [p] = await m.query(`SELECT 1 FROM products WHERE id = $1 AND is_active FOR SHARE`, [productId]);
      if (!p) throw new BusinessError('PRODUCT_NOT_FOUND', `Product ${productId} not found or inactive`);
      const [{ id }] = await m.query(
        `INSERT INTO sales_contract_line_products (sales_contract_line_id, product_id, reason, proposed_by) VALUES ($1, $2, $3, $4) RETURNING id`,
        [salesContractLineId, productId, reason, user.id],
      );
      return { id: id as number };
    });
  }

  /** Sales approves/rejects a PENDING proposal; stores who, when and the note/appendix number. */
  decide(user: CurrentUser, proposalId: number, approve: boolean, note: string | undefined) {
    return this.ds.transaction(async (m) => {
      const scope = await loadDataScope(m, user.id, true);
      if (!hasPermission(scope, VIEW) || !hasPermission(scope, 'SALES_CONTRACT.CONFIRM_PRODUCT')) throw new ForbiddenException();
      const [parent] = await m.query(
        `SELECT s.id FROM sales_contract_line_products p JOIN sales_contract_lines l ON l.id = p.sales_contract_line_id
          JOIN sales_contracts s ON s.id = l.sales_contract_id WHERE p.id = $1 FOR SHARE OF s`, [proposalId],
      );
      if (!parent) throw new NotFoundException();
      await assertCanAct(m, scope, VIEW, 'SALES_CONTRACT.CONFIRM_PRODUCT', SC_SOURCE, parent.id);
      const [x] = await m.query(`SELECT status, product_id FROM sales_contract_line_products WHERE id = $1 FOR UPDATE`, [proposalId]);
      if (!x) throw new NotFoundException('Proposal not found');
      if (x.status !== 'PENDING') throw new BusinessError('INVALID_STATUS', `Proposal is ${x.status}`, HttpStatus.CONFLICT);
      // An approved proposal counts as product usage (H5: pending/rejected do not).
      if (approve) await ProductUsage.markUsed(m, x.product_id, { stock: false, existingReference: true });
      await m.query(
        `UPDATE sales_contract_line_products SET status = $2, decided_by = $3, decided_at = now(), decision_note = $4 WHERE id = $1`,
        [proposalId, approve ? 'APPROVED' : 'REJECTED', user.id, note ?? null],
      );
    });
  }
}
