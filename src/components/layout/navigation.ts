export type NavigationItem = {
  href: string;
  label: string;
  icon: "dashboard" | "calendar" | "events" | "employees" | "timesheets" | "payroll" | "income" | "expenses" | "reports" | "assistant" | "settings";
};

export const navigationItems: NavigationItem[] = [
  { href: "/dashboard", label: "מרכז בקרה", icon: "dashboard" },
  { href: "/calendar", label: "לוח שנה", icon: "calendar" },
  { href: "/events", label: "אירועים", icon: "events" },
  { href: "/employees", label: "עובדים", icon: "employees" },
  { href: "/timesheets", label: "שעות עבודה", icon: "timesheets" },
  { href: "/payroll", label: "משכורות", icon: "payroll" },
  { href: "/income", label: "הכנסות", icon: "income" },
  { href: "/expenses", label: "הוצאות", icon: "expenses" },
  { href: "/reports", label: "דוחות", icon: "reports" },
  { href: "/assistant", label: "עוזר AI", icon: "assistant" },
  { href: "/settings", label: "הגדרות", icon: "settings" },
];
