import { HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import type { CurrentUser } from '../identity/auth';
import { ProductUsage } from '../master-data/product-usage';
import * as wf from '../workflow/workflow';
import { BusinessError } from '../workflow/workflow';

export interface ScLineInput { id?: number; itemCode: string; itemName: string; uomName: string; quantity: number }

/**
 * Facade for other modules (Procurement, Outbound). Runs inside the caller's transaction.
 * Lock order: HĐ line first (ARCHITECTURE §2.1a).
 */
export class SalesContractFacade {
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

  create(user: CurrentUser, customerId: number, responsibleSalesUserId: number | null, lines: ScLineInput[]) {
    return this.ds.transaction(async (m) => {
      const [customer] = await m.query(`SELECT 1 FROM customers WHERE id = $1`, [customerId]);
      if (!customer) throw new BusinessError('CUSTOMER_NOT_FOUND', `Customer ${customerId} not found`);
      await this.assertResponsibleSales(m, responsibleSalesUserId);
      const number = await wf.nextDocumentNumber(m, 'SC');
      const [sc] = await m.query(
        `INSERT INTO sales_contracts (document_number, customer_id, responsible_sales_user_id, created_by) VALUES ($1, $2, $3, $4) RETURNING id`,
        [number, customerId, responsibleSalesUserId, user.id],
      );
      for (const l of lines) {
        await m.query(`INSERT INTO sales_contract_lines (sales_contract_id, item_code, item_name, uom_name, quantity) VALUES ($1, $2, $3, $4, $5)`, [
          sc.id, l.itemCode, l.itemName, l.uomName, l.quantity,
        ]);
      }
      return { id: sc.id as number, documentNumber: number };
    });
  }

  /**
   * Sales edits a DRAFT contract: customer and lines (03 §9.1). Lines with `id` are updated in place so their ids
   * (product proposals) stay valid; new lines are inserted; omitted lines are deleted unless still referenced.
   * ACTIVE contracts are locked; PR/GIR only reference ACTIVE ones, so a DRAFT is never referenced by them.
   */
  update(user: CurrentUser, id: number, version: number, customerId: number, responsibleSalesUserId: number | null, lines: ScLineInput[]) {
    return this.ds.transaction(async (m) => {
      // FOR UPDATE serializes with activate/cancel and with PR/GIR creation (FOR SHARE in lockActiveLines).
      const [sc] = await m.query(`SELECT status, version FROM sales_contracts WHERE id = $1 FOR UPDATE`, [id]);
      if (!sc) throw new NotFoundException();
      if (sc.status !== 'DRAFT') throw new BusinessError('INVALID_STATUS', 'Only DRAFT sales contracts can be edited', HttpStatus.CONFLICT);
      if (sc.version !== version) throw new BusinessError('STALE_VERSION', 'The document was changed by someone else; reload and retry', HttpStatus.CONFLICT);
      const [customer] = await m.query(`SELECT 1 FROM customers WHERE id = $1`, [customerId]);
      if (!customer) throw new BusinessError('CUSTOMER_NOT_FOUND', `Customer ${customerId} not found`);
      await this.assertResponsibleSales(m, responsibleSalesUserId);
      await wf.deleteOmittedLines(m, 'sales_contract_lines', 'sales_contract_id', id, lines.flatMap((l) => (l.id ? [l.id] : [])));
      for (const l of lines) {
        if (l.id) {
          wf.assertLineUpdated(await m.query(
            `UPDATE sales_contract_lines SET item_code = $3, item_name = $4, uom_name = $5, quantity = $6 WHERE id = $1 AND sales_contract_id = $2`,
            [l.id, id, l.itemCode, l.itemName, l.uomName, l.quantity],
          ), l.id);
        } else {
          await m.query(`INSERT INTO sales_contract_lines (sales_contract_id, item_code, item_name, uom_name, quantity) VALUES ($1, $2, $3, $4, $5)`, [
            id, l.itemCode, l.itemName, l.uomName, l.quantity,
          ]);
        }
      }
      await m.query(
        `UPDATE sales_contracts SET customer_id = $2, responsible_sales_user_id = $4, version = version + 1, updated_by = $3, updated_at = now() WHERE id = $1`,
        [id, customerId, user.id, responsibleSalesUserId],
      );
    });
  }

  /** DRAFT → ACTIVE; ACTIVE never returns to DRAFT (H2). Requires a responsible sales, which is locked from then on (CT17). */
  async activate(id: number) {
    const [, count] = await this.ds.query(
      `UPDATE sales_contracts SET status = 'ACTIVE', version = version + 1 WHERE id = $1 AND status = 'DRAFT' AND responsible_sales_user_id IS NOT NULL`,
      [id],
    );
    if (count) return;
    const [sc] = await this.ds.query(`SELECT status FROM sales_contracts WHERE id = $1`, [id]);
    if (!sc) throw new NotFoundException();
    if (sc.status !== 'DRAFT') throw new BusinessError('INVALID_STATUS', 'Only DRAFT sales contracts can be activated', HttpStatus.CONFLICT);
    throw new BusinessError('RESPONSIBLE_SALES_REQUIRED', 'Assign a responsible sales before activating the contract');
  }

  /** Only DRAFT/ACTIVE contracts with no PR/GIR that is not CANCELED (H2, 03 §9.1). */
  cancel(id: number) {
    return this.ds.transaction(async (m) => {
      // FOR UPDATE waits for PR/GIR creation, which holds the contract FOR SHARE (lockActiveLines).
      const [sc] = await m.query(`SELECT status FROM sales_contracts WHERE id = $1 FOR UPDATE`, [id]);
      if (!sc) throw new NotFoundException();
      if (sc.status === 'CANCELED') throw new BusinessError('INVALID_STATUS', 'The sales contract is already canceled', HttpStatus.CONFLICT);
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

  list() {
    return this.ds.query(
      `SELECT s.id, s.document_number AS "documentNumber", s.status, c.name AS "customerName", s.created_at AS "createdAt",
              u.full_name AS "createdByName", rs.full_name AS "responsibleSalesName",
              (SELECT COUNT(*)::int FROM sales_contract_line_products x JOIN sales_contract_lines l ON l.id = x.sales_contract_line_id
                WHERE l.sales_contract_id = s.id AND x.status = 'PENDING') AS "pendingProposals"
         FROM sales_contracts s JOIN customers c ON c.id = s.customer_id JOIN users u ON u.id = s.created_by
         LEFT JOIN users rs ON rs.id = s.responsible_sales_user_id ORDER BY s.id DESC`,
    );
  }

  async get(id: number) {
    const [sc] = await this.ds.query(
      `SELECT s.id, s.document_number AS "documentNumber", s.status, s.version, s.customer_id AS "customerId",
              c.code AS "customerCode", c.name AS "customerName",
              s.created_by AS "createdBy", u.full_name AS "createdByName", s.created_at AS "createdAt",
              s.responsible_sales_user_id AS "responsibleSalesUserId", rs.full_name AS "responsibleSalesName",
              s.updated_at AS "updatedAt", (SELECT full_name FROM users WHERE id = s.updated_by) AS "updatedByName"
         FROM sales_contracts s JOIN customers c ON c.id = s.customer_id JOIN users u ON u.id = s.created_by
         LEFT JOIN users rs ON rs.id = s.responsible_sales_user_id WHERE s.id = $1`,
      [id],
    );
    if (!sc) throw new NotFoundException();
    return { ...sc, lines: await this.lines(id) };
  }

  /** Lines with confirmed (APPROVED) products and GIR quota usage, for GIR forms. */
  lines(id: number) {
    return this.ds.query(
      `SELECT l.id, l.item_code AS "itemCode", l.item_name AS "itemName", l.uom_name AS "uomName", l.quantity,
              COALESCE((SELECT json_agg(json_build_object('id', x.id, 'productId', p.id, 'partNumber', p.part_number, 'name', p.name,
                                                          'status', x.status, 'reason', x.reason, 'decisionNote', x.decision_note,
                                                          'proposedByName', pu.full_name, 'decidedByName', du.full_name, 'decidedAt', x.decided_at) ORDER BY x.id)
                          FROM sales_contract_line_products x JOIN products p ON p.id = x.product_id
                          JOIN users pu ON pu.id = x.proposed_by LEFT JOIN users du ON du.id = x.decided_by
                         WHERE x.sales_contract_line_id = l.id), '[]') AS products
         FROM sales_contract_lines l WHERE l.sales_contract_id = $1 ORDER BY l.id`,
      [id],
    );
  }

  /** PM proposes a product (incl. substitutes) for a HĐ line, with a reason (03 §9.2). */
  propose(user: CurrentUser, salesContractLineId: number, productId: number, reason: string) {
    return this.ds.transaction(async (m) => {
      const [line] = await m.query(
        `SELECT s.status FROM sales_contract_lines l JOIN sales_contracts s ON s.id = l.sales_contract_id WHERE l.id = $1`,
        [salesContractLineId],
      );
      if (!line) throw new NotFoundException('Sales contract line not found');
      if (line.status === 'CANCELED') throw new BusinessError('SALES_CONTRACT_CANCELED', 'The sales contract is canceled');
      const [p] = await m.query(`SELECT 1 FROM products WHERE id = $1 AND is_active`, [productId]);
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
      const [x] = await m.query(`SELECT status, product_id FROM sales_contract_line_products WHERE id = $1 FOR UPDATE`, [proposalId]);
      if (!x) throw new NotFoundException('Proposal not found');
      if (x.status !== 'PENDING') throw new BusinessError('INVALID_STATUS', `Proposal is ${x.status}`, HttpStatus.CONFLICT);
      // An approved proposal counts as product usage (H5: pending/rejected do not).
      if (approve) await ProductUsage.markUsed(m, x.product_id, { stock: false });
      await m.query(
        `UPDATE sales_contract_line_products SET status = $2, decided_by = $3, decided_at = now(), decision_note = $4 WHERE id = $1`,
        [proposalId, approve ? 'APPROVED' : 'REJECTED', user.id, note ?? null],
      );
    });
  }
}
