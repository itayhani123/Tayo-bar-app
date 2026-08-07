import assert from "node:assert/strict";
import test from "node:test";
import { calculateEventRevenue, calculateIncomeTaxAdvance, calculateOperationalProfit, calculateVat } from "./calculations";

test("18% VAT is added to a VAT-excluded price", () => assert.deepEqual(calculateVat({ guestCount: 10, pricePerGuest: 100, vatRate: 18, priceIncludesVat: false }), { netRevenue: 1000, vatAmount: 180, grossRevenue: 1180 }));
test("18% VAT is extracted from a VAT-included price", () => assert.deepEqual(calculateVat({ guestCount: 1, pricePerGuest: 118, vatRate: 18, priceIncludesVat: true }), { netRevenue: 100, vatAmount: 18, grossRevenue: 118 }));
test("income-tax advance is 3.2% of net revenue", () => assert.equal(calculateIncomeTaxAdvance(1000, 3.2), 32));
test("zero revenue produces zero VAT and advance", () => { assert.equal(calculateEventRevenue(0, 99.9), 0); assert.deepEqual(calculateVat({ guestCount: 0, pricePerGuest: 99.9, vatRate: 18, priceIncludesVat: false }), { netRevenue: 0, vatAmount: 0, grossRevenue: 0 }); assert.equal(calculateIncomeTaxAdvance(0, 3.2), 0); });
test("decimal values are rounded to currency precision", () => assert.deepEqual(calculateVat({ guestCount: 3, pricePerGuest: 33.33, vatRate: 18, priceIncludesVat: false }), { netRevenue: 99.99, vatAmount: 18, grossRevenue: 117.99 }));
test("300 guests at 15 ILS remains a 4500 ILS VAT-inclusive total", () => assert.deepEqual(calculateVat({ guestCount: 300, pricePerGuest: 15, vatRate: 18, priceIncludesVat: true }), { netRevenue: 3813.56, vatAmount: 686.44, grossRevenue: 4500 }));
test("operational profit uses net revenue", () => assert.equal(calculateOperationalProfit(3813.56, 1000, 500), 2313.56));
