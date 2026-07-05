export interface SettlementLineInput {
  id: string;
  unitPriceVnd: number;
  quantity: number;
}

export interface ProjectionSettlementInput {
  id: string;
  lineId: string;
  type: 'PAID' | 'WAIVED';
  status: 'ACTIVE' | 'REVERSED';
  quantity: number;
  amountVnd: number;
}

export interface LineSettlementState {
  paidQuantity: number;
  waivedQuantity: number;
  outstandingQuantity: number;
  paidTotalVnd: number;
  waivedTotalVnd: number;
  outstandingTotalVnd: number;
}

function addSafe(current: number, value: number, label: string): number {
  const next = current + value;

  if (!Number.isSafeInteger(next) || next < 0) {
    throw new Error(`${label} exceeded safe integer limits.`);
  }

  return next;
}

export function buildLineSettlementStateMap(input: {
  lines: SettlementLineInput[];
  settlements?: ProjectionSettlementInput[] | undefined;
}): Map<string, LineSettlementState> {
  const lineById = new Map(input.lines.map((line) => [line.id, line]));
  const mutable = new Map<
    string,
    {
      paidQuantity: number;
      waivedQuantity: number;
      paidTotalVnd: number;
      waivedTotalVnd: number;
    }
  >();

  for (const line of input.lines) {
    if (
      line.quantity <= 0 ||
      line.unitPriceVnd < 0 ||
      !Number.isSafeInteger(line.quantity) ||
      !Number.isSafeInteger(line.unitPriceVnd)
    ) {
      throw new Error(`Invalid settlement source line ${line.id}.`);
    }

    mutable.set(line.id, {
      paidQuantity: 0,
      waivedQuantity: 0,
      paidTotalVnd: 0,
      waivedTotalVnd: 0,
    });
  }

  for (const settlement of input.settlements ?? []) {
    const line = lineById.get(settlement.lineId);

    if (!line) {
      throw new Error(`Settlement ${settlement.id} references an unknown line.`);
    }

    if (
      settlement.quantity <= 0 ||
      settlement.amountVnd !== line.unitPriceVnd * settlement.quantity ||
      !Number.isSafeInteger(settlement.amountVnd)
    ) {
      throw new Error(`Settlement ${settlement.id} has invalid financial values.`);
    }

    if (settlement.status === 'REVERSED') {
      continue;
    }

    const state = mutable.get(settlement.lineId);

    if (!state) {
      throw new Error(`Settlement state missing for line ${settlement.lineId}.`);
    }

    if (settlement.type === 'PAID') {
      state.paidQuantity = addSafe(state.paidQuantity, settlement.quantity, 'Paid quantity');
      state.paidTotalVnd = addSafe(state.paidTotalVnd, settlement.amountVnd, 'Paid total');
    } else {
      state.waivedQuantity = addSafe(state.waivedQuantity, settlement.quantity, 'Waived quantity');
      state.waivedTotalVnd = addSafe(state.waivedTotalVnd, settlement.amountVnd, 'Waived total');
    }
  }

  const result = new Map<string, LineSettlementState>();

  for (const line of input.lines) {
    const state = mutable.get(line.id);

    if (!state) {
      throw new Error(`Settlement state missing for line ${line.id}.`);
    }

    const allocatedQuantity = state.paidQuantity + state.waivedQuantity;

    if (allocatedQuantity > line.quantity) {
      throw new Error(`Settlements exceed quantity for line ${line.id}.`);
    }

    const grossTotalVnd = line.unitPriceVnd * line.quantity;
    const allocatedTotalVnd = state.paidTotalVnd + state.waivedTotalVnd;

    result.set(line.id, {
      ...state,
      outstandingQuantity: line.quantity - allocatedQuantity,
      outstandingTotalVnd: grossTotalVnd - allocatedTotalVnd,
    });
  }

  return result;
}
