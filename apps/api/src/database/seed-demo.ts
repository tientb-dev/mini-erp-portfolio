import 'reflect-metadata';
import './env';
import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { AppModule } from '../app.module';
import { IdentityService } from '../modules/identity/auth';
import { InboundService } from '../modules/inbound/inbound.service';
import { ProcurementService } from '../modules/procurement/procurement.service';
import { SalesContractsService } from "../modules/sales-contracts/sales-contracts.service";
import { env } from './env';

/**
 * Demo data via the real services (same rules as the API); requires `pnpm seed` first. Each run creates:
 *  - HĐ (ACTIVE) with Sales-confirmed products per line,
 *  - PR → PO → GRR (APPROVED) ready for a GR in the UI,
 *  - plus a second GRR received by an APPROVED GR (stock + SNs in HCM), ready for GIR → GI in the UI.
 */
async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  try {
    const ds = app.get(DataSource);
    const identity = app.get(IdentityService);
    const proc = app.get(ProcurementService);
    const inbound = app.get(InboundService);
    const sales = app.get(SalesContractsService);

    const userId = async (username: string) => (await ds.query(`SELECT id FROM users WHERE username = $1`, [username]))[0].id as number;
    const creator = (await identity.loadCurrentUser(await userId(env('SEED_ADMIN_USERNAME'))))!;
    const approver = (await identity.loadCurrentUser(await userId(env('SEED_APPROVER_USERNAME'))))!;
    const one = async (sql: string, params: unknown[]) => (await ds.query(sql, params))[0];

    const [{ id: pcs }] = await ds.query(`SELECT id FROM units_of_measure WHERE code = 'PCS'`);
    const [{ id: hcm }] = await ds.query(`SELECT id FROM warehouses WHERE code = 'HCM'`);
    await ds.query(`INSERT INTO products (part_number, name, unit_of_measure_id, is_serial_tracked) VALUES
      ('RT-AX3000', 'Router Wi-Fi AX3000', $1, true), ('CB-CAT6-305', 'Cáp mạng Cat6 (thùng 305m)', $1, false)
      ON CONFLICT (part_number) DO NOTHING`, [pcs]);
    const router = (await one(`SELECT id FROM products WHERE part_number = 'RT-AX3000'`, [])).id;
    const cable = (await one(`SELECT id FROM products WHERE part_number = 'CB-CAT6-305'`, [])).id;
    await ds.query(`INSERT INTO customers (code, name) VALUES ('KH-DEMO', 'Công ty Demo') ON CONFLICT (code) DO NOTHING`);
    await ds.query(`INSERT INTO suppliers (code, name) VALUES ('NCC-DEMO', 'Nhà cung cấp Demo') ON CONFLICT (code) DO NOTHING`);
    const customer = (await one(`SELECT id FROM customers WHERE code = 'KH-DEMO'`, [])).id;
    const supplier = (await one(`SELECT id FROM suppliers WHERE code = 'NCC-DEMO'`, [])).id;

    const sc = await sales.create(creator, customer, [
      { itemCode: 'RT-AX3000', itemName: 'Router Wi-Fi AX3000', uomName: 'Cái', quantity: 3 },
      { itemCode: 'CB-CAT6', itemName: 'Cáp mạng Cat6', uomName: 'Cái', quantity: 2 },
    ]);
    await sales.activate(sc.id);
    const scLines = await ds.query(`SELECT id FROM sales_contract_lines WHERE sales_contract_id = $1 ORDER BY id`, [sc.id]);
    const pr = await proc.createPurchaseRequisition(creator, sc.id, [
      { salesContractLineId: scLines[0].id, productId: router, quantity: 3 },
      { salesContractLineId: scLines[1].id, productId: cable, quantity: 2 },
    ]);
    await proc.submit('PR', pr.id, creator, approver.id);
    await proc.approve('PR', pr.id, approver);
    const prLines = await ds.query(`SELECT id, quantity FROM purchase_requisition_lines WHERE purchase_requisition_id = $1 ORDER BY id`, [pr.id]);
    const po = await proc.createPurchaseOrder(creator, supplier, prLines.map((l: { id: number; quantity: string }) => ({ sourceLineId: l.id, quantity: Number(l.quantity) })));
    await proc.submit('PO', po.id, creator, approver.id);
    await proc.approve('PO', po.id, approver);
    const poLines = await ds.query(`SELECT id, quantity FROM purchase_order_lines WHERE purchase_order_id = $1 ORDER BY id`, [po.id]);
    const grr = await inbound.createGrr(creator, po.id, hcm, poLines.map((l: { id: number; quantity: string }) => ({ sourceLineId: l.id, quantity: Number(l.quantity) })));
    await inbound.submitGrr(grr.id, creator, approver.id);
    await inbound.approveGrr(grr.id, approver);
    // Sales confirms the products allowed for delivery on each HĐ line (PM proposes, Sales decides).
    for (const [line, product] of [[scLines[0].id, router], [scLines[1].id, cable]]) {
      const p = await sales.propose(creator, line, product, "Đúng hàng theo hợp đồng");
      await sales.decide(approver, p.id, true, "PL-01");
    }

    // A second chain (PR → PO → GRR → GR APPROVED) puts stock + SNs in HCM for GIR → GI; the first GRR stays open for the GR UI.
    const stockPr = await proc.createPurchaseRequisition(creator, sc.id, [
      { salesContractLineId: scLines[0].id, productId: router, quantity: 3 },
      { salesContractLineId: scLines[1].id, productId: cable, quantity: 2 },
    ]);
    await proc.submit("PR", stockPr.id, creator, approver.id);
    await proc.approve("PR", stockPr.id, approver);
    const spl = await ds.query(`SELECT id, quantity FROM purchase_requisition_lines WHERE purchase_requisition_id = $1 ORDER BY id`, [stockPr.id]);
    const stockPo = await proc.createPurchaseOrder(creator, supplier, spl.map((l: { id: number; quantity: string }) => ({ sourceLineId: l.id, quantity: Number(l.quantity) })));
    await proc.submit("PO", stockPo.id, creator, approver.id);
    await proc.approve("PO", stockPo.id, approver);
    const sol = await ds.query(`SELECT id, quantity FROM purchase_order_lines WHERE purchase_order_id = $1 ORDER BY id`, [stockPo.id]);
    const stockGrr = await inbound.createGrr(creator, stockPo.id, hcm, sol.map((l: { id: number; quantity: string }) => ({ sourceLineId: l.id, quantity: Number(l.quantity) })));
    await inbound.submitGrr(stockGrr.id, creator, approver.id);
    await inbound.approveGrr(stockGrr.id, approver);
    const gr = await inbound.createGr(creator, stockGrr.id);
    const details: { id: number }[] = await ds.query(
      `SELECT d.id FROM goods_receipt_details d JOIN goods_receipt_lines l ON l.id = d.goods_receipt_line_id
         WHERE l.goods_receipt_id = $1 AND l.product_id = $2 ORDER BY d.id`,
      [gr.id, router],
    );
    const tag = gr.documentNumber.slice(-6);
    await inbound.updateGrDetails(gr.id, creator, 1, details.map((d, i) => ({ id: d.id, serialNumber: `AX-${tag}-${i + 1}` })));
    await inbound.submitGr(gr.id, creator, approver.id);
    await inbound.approveGr(gr.id, approver);

    console.log(`Demo ready: ${sc.documentNumber} (products confirmed); ${grr.documentNumber} APPROVED for a GR; ${gr.documentNumber} APPROVED (stock in HCM)`);
  } finally {
    await app.close();
  }
}

void main();
