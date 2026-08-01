export type NavigationItem = {
  href: string;
  label: string;
  icon: "dashboard" | "calendar" | "events" | "employees" | "timesheets" | "payroll" | "income" | "expenses" | "reports" | "assistant" | "settings";
};

export const navigationItems: NavigationItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: "dashboard" },
  { href: "/calendar", label: "Calendar", icon: "calendar" },
  { href: "/events", label: "Events", icon: "events" },
  { href: "/employees", label: "Employees", icon: "employees" },
  { href: "/timesheets", label: "Timesheets", icon: "timesheets" },
  { href: "/payroll", label: "Payroll", icon: "payroll" },
  { href: "/income", label: "Income", icon: "income" },
  { href: "/expenses", label: "Expenses", icon: "expenses" },
  { href: "/reports", label: "Reports", icon: "reports" },
  { href: "/assistant", label: "AI Assistant", icon: "assistant" },
  { href: "/settings", label: "Settings", icon: "settings" },
];
