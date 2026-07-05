import { billProjectionSummarySchema, type BillProjectionSummary } from '@nhdp/contracts';

import { buildLineSettlementStateMap, type ProjectionSettlementInput } from './settlement-state.js';

export interface ProjectionOrderInput {
  id: string;
  status: 'PENDING' | 'ACCEPTED' | 'SERVED' | 'CANCELLED';
}

export interface ProjectionLineInput {
  id: string;
  orderId: string;
  lineKind?: 'CATALOG' | 'MANUAL_PRODUCT' | 'MANUAL_TIME';
  catalogItemId: string | null;
  itemName: string;
  unitName: string;
  imagePublicId: string | null;
  unitPriceVnd: number;
  quantity: number;
  lineTotalVnd: number;
  status: 'ACTIVE' | 'VOIDED';
  createdAt: Date;
}

interface MutableProjectionItem {
  lineKind: 'CATALOG' | 'MANUAL_PRODUCT' | 'MANUAL_TIME';
  catalogItemId: string | null;
  itemName: string;
  unitName: string;
  imagePublicId: string | null;
  unitPriceVnd: number;
  orderedQuantity: number;
  grossTotalVnd: number;
  paidQuantity: number;
  waivedQuantity: number;
  paidTotalVnd: number;
  waivedTotalVnd: number;
  sourceOrderIds: Set<string>;
  sourceLineIds: string[];
  firstOrderedAt: Date;
}

function groupKey(line: ProjectionLineInput): string {
  return JSON.stringify([
    line.lineKind ?? 'CATALOG',
    line.catalogItemId,
    line.itemName,
    line.unitName,
    line.unitPriceVnd,
  ]);
}

function addMoney(current: number, amount: number): number {
  const next = current + amount;
  if (!Number.isSafeInteger(next) || next < 0) {
    throw new Error('Bill projection exceeded safe integer money limits.');
  }
  return next;
}

export function buildBillProjection(input: {
  orders: ProjectionOrderInput[];
  lines: ProjectionLineInput[];
  settlements?: ProjectionSettlementInput[];
}): BillProjectionSummary {
  const orderStatusById = new Map(input.orders.map((order) => [order.id, order.status]));
  const settlementStateByLine = buildLineSettlementStateMap({
    lines: input.lines.map((line) => ({
      id: line.id,
      unitPriceVnd: line.unitPriceVnd,
      quantity: line.quantity,
    })),
    settlements: input.settlements,
  });
  const grouped = new Map<string, MutableProjectionItem>();

  for (const line of input.lines) {
    if (line.status !== 'ACTIVE' || orderStatusById.get(line.orderId) === 'CANCELLED') {
      continue;
    }

    if (line.quantity <= 0 || line.lineTotalVnd !== line.unitPriceVnd * line.quantity) {
      throw new Error(`Invalid active bill line ${line.id}.`);
    }

    const settlementState = settlementStateByLine.get(line.id);

    if (!settlementState) {
      throw new Error(`Settlement state missing for active line ${line.id}.`);
    }

    const key = groupKey(line);
    const existing = grouped.get(key);

    if (existing) {
      existing.orderedQuantity += line.quantity;
      existing.grossTotalVnd = addMoney(existing.grossTotalVnd, line.lineTotalVnd);
      existing.paidQuantity += settlementState.paidQuantity;
      existing.waivedQuantity += settlementState.waivedQuantity;
      existing.paidTotalVnd = addMoney(existing.paidTotalVnd, settlementState.paidTotalVnd);
      existing.waivedTotalVnd = addMoney(existing.waivedTotalVnd, settlementState.waivedTotalVnd);
      existing.sourceOrderIds.add(line.orderId);
      existing.imagePublicId = line.imagePublicId ?? existing.imagePublicId;
      existing.sourceLineIds.push(line.id);
      if (line.createdAt < existing.firstOrderedAt) {
        existing.firstOrderedAt = line.createdAt;
      }
      continue;
    }

    grouped.set(key, {
      lineKind: line.lineKind ?? 'CATALOG',
      catalogItemId: line.catalogItemId,
      itemName: line.itemName,
      unitName: line.unitName,
      imagePublicId: line.imagePublicId,
      unitPriceVnd: line.unitPriceVnd,
      orderedQuantity: line.quantity,
      grossTotalVnd: line.lineTotalVnd,
      paidQuantity: settlementState.paidQuantity,
      waivedQuantity: settlementState.waivedQuantity,
      paidTotalVnd: settlementState.paidTotalVnd,
      waivedTotalVnd: settlementState.waivedTotalVnd,
      sourceOrderIds: new Set([line.orderId]),
      sourceLineIds: [line.id],
      firstOrderedAt: line.createdAt,
    });
  }

  const items = [...grouped.values()]
    .sort(
      (left, right) =>
        left.firstOrderedAt.getTime() - right.firstOrderedAt.getTime() ||
        left.itemName.localeCompare(right.itemName, 'vi') ||
        left.unitPriceVnd - right.unitPriceVnd,
    )
    .map((item) => ({
      lineKind: item.lineKind,
      catalogItemId: item.catalogItemId,
      itemName: item.itemName,
      unitName: item.unitName,
      imagePublicId: item.imagePublicId,
      unitPriceVnd: item.unitPriceVnd,
      orderedQuantity: item.orderedQuantity,
      paidQuantity: item.paidQuantity,
      waivedQuantity: item.waivedQuantity,
      outstandingQuantity: item.orderedQuantity - item.paidQuantity - item.waivedQuantity,
      grossTotalVnd: item.grossTotalVnd,
      paidTotalVnd: item.paidTotalVnd,
      waivedTotalVnd: item.waivedTotalVnd,
      outstandingTotalVnd: item.grossTotalVnd - item.paidTotalVnd - item.waivedTotalVnd,
      sourceOrderIds: [...item.sourceOrderIds],
      sourceLineIds: item.sourceLineIds,
      firstOrderedAt: item.firstOrderedAt.toISOString(),
    }));

  const grossTotalVnd = items.reduce((total, item) => addMoney(total, item.grossTotalVnd), 0);
  const paidTotalVnd = items.reduce((total, item) => addMoney(total, item.paidTotalVnd), 0);
  const waivedTotalVnd = items.reduce((total, item) => addMoney(total, item.waivedTotalVnd), 0);
  const outstandingTotalVnd = grossTotalVnd - paidTotalVnd - waivedTotalVnd;

  return billProjectionSummarySchema.parse({
    grossTotalVnd,
    paidTotalVnd,
    waivedTotalVnd,
    outstandingTotalVnd,
    items,
  });
}
