import type { NavigationItem } from "@/components/layout/navigation";

type IconName = NavigationItem["icon"] | "menu" | "close" | "bell" | "chevron";

const paths: Record<IconName, React.ReactNode> = {
  dashboard: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 10h18" /></>,
  events: <><path d="M12 3v18M3 12h18" /><path d="M5.6 5.6l12.8 12.8M18.4 5.6L5.6 18.4" /></>,
  employees: <><circle cx="9" cy="8" r="3" /><circle cx="17" cy="9" r="2" /><path d="M3.5 20c.6-3.3 2.4-5 5.5-5s4.9 1.7 5.5 5M15 15c2.9.1 4.6 1.7 5 4" /></>,
  timesheets: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7v5l3 2" /></>,
  payroll: <><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 8h8M8 12h8M8 16h4" /></>,
  income: <><path d="M4 18l5-5 3 3 7-8" /><path d="M14 8h5v5" /></>,
  expenses: <><path d="M4 6h16M6 6l1 14h10l1-14M9 6V4h6v2" /></>,
  reports: <><path d="M5 20V10M12 20V4M19 20v-7" /></>,
  assistant: <><path d="M12 3l1.5 5.5L19 10l-5.5 1.5L12 17l-1.5-5.5L5 10l5.5-1.5L12 3Z" /><path d="M19 16l.6 2.4L22 19l-2.4.6L19 22l-.6-2.4L16 19l2.4-.6L19 16Z" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.2 2.2-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5v.2h-3.2v-.2a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1-2.2-2.2.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H5v-3.2h.2a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1 2.2-2.2.1.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.5V3.5h3.2v.2a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1 2.2 2.2-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.5 1h.2V13h-.2a1.7 1.7 0 0 0-1.5 2Z" /></>,
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  close: <path d="M5 5l14 14M19 5L5 19" />,
  bell: <><path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" /></>,
  chevron: <path d="m9 18 6-6-6-6" />,
};

export function Icon({ name, className = "" }: { name: IconName; className?: string }) {
  return <svg aria-hidden="true" className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}
