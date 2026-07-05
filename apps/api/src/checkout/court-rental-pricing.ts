export interface CourtRentalPriceRequest {
  startTime: string;
  durationHours: number;
}

export interface CourtRentalPriceBlock {
  sequence: number;
  startsAt: string;
  endsAt: string;
  basePriceVnd: number;
  surchargeVnd: number;
  totalVnd: number;
}

export interface CourtRentalPriceResult {
  startTime: string;
  durationHours: number;
  baseAmountVnd: number;
  surchargeAmountVnd: number;
  totalAmountVnd: number;
  breakdown: CourtRentalPriceBlock[];
}

function parseTime(value: string): number {
  const separatorIndex = value.indexOf(':');
  if (separatorIndex !== 2 || value.length !== 5) {
    throw new Error('Court rental start time must use HH:mm format.');
  }

  const hour = Number(value.slice(0, separatorIndex));
  const minute = Number(value.slice(separatorIndex + 1));
  if (!Number.isInteger(hour) || hour < 0 || hour > 23 || (minute !== 0 && minute !== 30)) {
    throw new Error('Court rental start time must use a valid 30-minute boundary.');
  }

  return hour * 60 + minute;
}

function formatTime(totalMinutes: number): string {
  const normalized = ((totalMinutes % 1_440) + 1_440) % 1_440;
  const hour = Math.floor(normalized / 60);
  const minute = normalized % 60;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function basePriceForStart(totalMinutes: number): number {
  const minuteOfDay = ((totalMinutes % 1_440) + 1_440) % 1_440;
  if (minuteOfDay >= 17 * 60 && minuteOfDay < 19 * 60) return 140_000;
  if (minuteOfDay >= 19 * 60 || minuteOfDay < 5 * 60) return 120_000;
  return 100_000;
}

export function calculateCourtRentalPrice(
  servicePointCode: string,
  request: CourtRentalPriceRequest,
): CourtRentalPriceResult {
  const startMinutes = parseTime(request.startTime);
  const surchargePerHour = servicePointCode === 'COURT-03' ? 30_000 : 0;
  const breakdown = Array.from({ length: request.durationHours }, (_, index) => {
    const blockStart = startMinutes + index * 60;
    const basePriceVnd = basePriceForStart(blockStart);
    return {
      sequence: index + 1,
      startsAt: formatTime(blockStart),
      endsAt: formatTime(blockStart + 60),
      basePriceVnd,
      surchargeVnd: surchargePerHour,
      totalVnd: basePriceVnd + surchargePerHour,
    };
  });
  const baseAmountVnd = breakdown.reduce((sum, item) => sum + item.basePriceVnd, 0);
  const surchargeAmountVnd = breakdown.reduce((sum, item) => sum + item.surchargeVnd, 0);

  return {
    startTime: request.startTime,
    durationHours: request.durationHours,
    baseAmountVnd,
    surchargeAmountVnd,
    totalAmountVnd: baseAmountVnd + surchargeAmountVnd,
    breakdown,
  };
}
