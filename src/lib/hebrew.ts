export const eventTypeLabels: Record<string, string> = {
  Wedding: "חתונה", Brit: "ברית", "Bar Mitzvah": "בר מצווה", "Bat Mitzvah": "בת מצווה",
  Business: "עסקי", Henna: "חינה", Other: "אחר",
};

export const packageLabels: Record<string, string> = {
  Pouring: "דמי מזיגה", Premium: "פרימיום", "Super Premium": "סופר פרימיום", "Ultra Premium": "אולטרה פרימיום",
};

export const payerLabels = { client: "לקוח", venue: "אולם" } as const;
export const paymentStatusLabels = { unpaid: "לא שולם", partial: "שולם חלקית", paid: "שולם במלואו" } as const;
export const paymentMethodLabels: Record<string, string> = { Cash: "מזומן", "Bank Transfer": "העברה בנקאית", Check: "צ׳ק", Bit: "ביט", PayBox: "פייבוקס" };
export const formatPaymentMethod = (value: string) => paymentMethodLabels[value] ?? value;
export const translateStoredValue = (value: string) => eventTypeLabels[value] ?? packageLabels[value] ?? value;
export const formatDate = (value: string | Date) => new Intl.DateTimeFormat("he-IL", { dateStyle: "medium" }).format(new Date(value));
export const formatMoney = (value: number) => new Intl.NumberFormat("he-IL", { style: "currency", currency: "ILS", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
