import type { AppRole } from "@/lib/auth/user";
export type NavigationItem = { href: string; label: string; icon: "dashboard" | "calendar" | "events" | "employees" | "timesheets" | "payroll" | "income" | "expenses" | "reports" | "assistant" | "settings"; roles: AppRole[] };
const both: AppRole[] = ["owner", "manager"];
const owner: AppRole[] = ["owner"];
export const navigationItems: NavigationItem[] = [
  { href: "/dashboard", label: "מרכז בקרה", icon: "dashboard", roles: both },
  { href: "/calendar", label: "לוח שנה", icon: "calendar", roles: both },
  { href: "/events", label: "אירועים", icon: "events", roles: both },
  { href: "/employees", label: "עובדים", icon: "employees", roles: both },
  { href: "/timesheets", label: "שעות עבודה", icon: "timesheets", roles: both },
  { href: "/payroll", label: "משכורות", icon: "payroll", roles: owner },
  { href: "/income", label: "הכנסות", icon: "income", roles: owner },
  { href: "/receivables", label: "יתרות לגבייה", icon: "income", roles: owner },
  { href: "/expenses", label: "הוצאות", icon: "expenses", roles: owner },
  { href: "/reports", label: "דוחות", icon: "reports", roles: owner },
  { href: "/assistant", label: "עוזר AI", icon: "assistant", roles: owner },
  { href: "/settings", label: "הגדרות", icon: "settings", roles: owner },
  { href: "/venues", label: "אולמות", icon: "settings", roles: owner },
  { href: "/bar-packages", label: "חבילות בר", icon: "settings", roles: owner },
  { href: "/event-types", label: "סוגי אירועים", icon: "settings", roles: owner },
  { href: "/payment-methods", label: "אמצעי תשלום", icon: "settings", roles: owner },
];
export const navigationItemsForRole = (role: AppRole) => navigationItems.filter((item) => item.roles.includes(role));
