import { roundMoney } from "@/lib/finance/calculations";
export function calculateExpenseVat(amount: number, includesVat: boolean, vatRate: number) {
  const rate = Math.max(vatRate,0)/100;
  if (includesVat) { const gross=roundMoney(amount); const net=rate ? roundMoney(gross/(1+rate)) : gross; return { net, vat: roundMoney(gross-net), gross }; }
  const net=roundMoney(amount); const vat=roundMoney(net*rate); return { net, vat, gross: roundMoney(net+vat) };
}
