import type { EventFinanceInput, VatCalculation } from "./types";

export const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
export const calculateEventRevenue = (guestCount: number, pricePerGuest: number) => roundMoney(Math.max(guestCount, 0) * Math.max(pricePerGuest, 0));

export function calculateVat(input: EventFinanceInput): VatCalculation {
  const baseAmount = calculateEventRevenue(input.guestCount, input.pricePerGuest);
  const rate = Math.max(input.vatRate, 0) / 100;
  if (input.priceIncludesVat) {
    const grossRevenue = baseAmount;
    const netRevenue = rate === 0 ? grossRevenue : roundMoney(grossRevenue / (1 + rate));
    return { netRevenue, vatAmount: roundMoney(grossRevenue - netRevenue), grossRevenue };
  }
  const netRevenue = baseAmount;
  const vatAmount = roundMoney(netRevenue * rate);
  return { netRevenue, vatAmount, grossRevenue: roundMoney(netRevenue + vatAmount) };
}

export const calculateOperationalProfit = (netRevenue: number, staffCost: number, alcoholCost: number) => roundMoney(netRevenue - staffCost - alcoholCost);
export const calculateIncomeTaxAdvance = (netRevenue: number, rate: number) => roundMoney(Math.max(netRevenue, 0) * Math.max(rate, 0) / 100);
export const calculateEstimatedAfterAdvance = (operationalProfit: number, advance: number) => roundMoney(operationalProfit - advance);
