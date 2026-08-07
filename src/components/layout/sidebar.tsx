"use client";
import { useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { navigationItemsForRole } from "@/components/layout/navigation";
import { Icon } from "@/components/ui/icon";
import type { AppRole } from "@/lib/auth/user";

type SidebarProps = { isOpen: boolean; onClose: () => void; role: AppRole };

export function Sidebar({ isOpen, onClose, role }: SidebarProps) {
  return <><DesktopSidebar role={role} /><MobileSidebar role={role} isOpen={isOpen} onClose={onClose} /></>;
}

export function DesktopSidebar({ role }: { role: AppRole }) {
  return <aside className="fixed inset-y-0 right-0 z-40 hidden w-[272px] flex-col border-l border-slate-200 bg-white px-4 py-5 lg:flex"><SidebarHeader /><NavigationLinks role={role} /><SidebarFooter /></aside>;
}

export function MobileSidebar({ isOpen, onClose, role }: SidebarProps) {
  const pathname = usePathname(); const previousPathname = useRef(pathname);
  useEffect(() => { if (!isOpen) return; const previousOverflow = document.body.style.overflow; document.body.style.overflow = "hidden"; const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); }; window.addEventListener("keydown", closeOnEscape); return () => { document.body.style.overflow = previousOverflow; window.removeEventListener("keydown", closeOnEscape); }; }, [isOpen, onClose]);
  useEffect(() => { if (previousPathname.current !== pathname) { previousPathname.current = pathname; onClose(); } }, [pathname, onClose]);
  if (!isOpen) return null;
  return <div className="fixed inset-0 z-[90] lg:hidden"><button type="button" aria-label="סגירת תפריט" onClick={onClose} className="absolute inset-0 z-0 cursor-default bg-slate-950/45" /><aside role="dialog" aria-modal="true" aria-label="תפריט ניווט" className="absolute inset-y-0 right-0 z-10 flex w-[min(86vw,320px)] max-w-full flex-col overflow-y-auto border-l border-slate-200 bg-white px-4 py-5 text-right shadow-2xl"><div className="flex items-center justify-between px-3"><SidebarLogo onNavigate={onClose} /><button type="button" aria-label="סגירת תפריט" onClick={onClose} className="grid size-10 shrink-0 place-items-center rounded-lg text-slate-600 hover:bg-slate-100"><Icon name="close" className="size-5" /></button></div><NavigationLinks role={role} onNavigate={onClose} /><SidebarFooter /></aside></div>;
}

function NavigationLinks({ role, onNavigate }: { role: AppRole; onNavigate?: () => void }) {
  const pathname = usePathname(); const allowedItems = navigationItemsForRole(role);
  return <nav aria-label="ניווט ראשי" className="mt-10 flex flex-1 flex-col gap-1">{allowedItems.map((item) => { const active = pathname === item.href; return <Link key={item.href} href={item.href} onClick={onNavigate} className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-right text-sm font-medium transition-colors ${active ? "bg-indigo-50 text-indigo-700" : "text-slate-600 hover:bg-slate-50 hover:text-slate-950"}`}><Icon name={item.icon} className="size-5 shrink-0" /><span>{item.label}</span></Link>; })}</nav>;
}
function SidebarHeader() { return <div className="flex items-center px-3"><SidebarLogo /></div>; }
function SidebarLogo({ onNavigate }: { onNavigate?: () => void }) { return <Link href="/dashboard" className="flex min-w-0 items-center gap-3" onClick={onNavigate}><span className="grid size-9 shrink-0 place-items-center rounded-xl bg-indigo-600 text-lg font-bold text-white">T</span><span className="truncate text-lg font-semibold tracking-tight text-slate-950">Tayo Bar</span></Link>; }
function SidebarFooter() { return <div className="mt-4 rounded-xl bg-slate-50 p-3"><p className="text-xs font-medium text-slate-900">Tayo Bar ERP</p><p className="mt-1 text-xs leading-5 text-slate-500">מרכז התפעול שלך.</p></div>; }
