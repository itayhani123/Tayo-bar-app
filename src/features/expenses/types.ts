export const EXPENSE_CATEGORIES = ["אלכוהול","עובדים","הובלה","ציוד","קרח","פירות וקישוטים","חד פעמי","דלק","שיווק","משרד","עמלות","אחר"] as const;
export type ExpenseFormValues = { expenseDate: string; category: string; supplierName: string; description: string; amount: number; includesVat: boolean; vatRate: number; paymentMethod: string; referenceNumber: string; eventId: string; notes: string };
export type Expense = ExpenseFormValues & { id: string; createdAt: string; updatedAt: string };
export type ExpenseEventOption = { id: string; label: string };
export type ExpensesResponse = { expenses: Expense[]; events: ExpenseEventOption[] };
