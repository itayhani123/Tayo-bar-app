"use client";
import { useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { navigationItemsForRole } from "@/components/layout/navigation";
import { Icon } from "@/components/ui/icon";
import type { AppRole } from "@/lib/auth/user";
import Image from "next/image";
import { LogoutButton } from "@/components/layout/logout-button";

type SidebarProps = { isOpen: boolean; onClose: () => void; role: AppRole };

export function Sidebar({ isOpen, onClose, role }: SidebarProps) {
  return <><DesktopSidebar role={role} /><MobileSidebar role={role} isOpen={isOpen} onClose={onClose} /></>;
}

export function DesktopSidebar({ role }: { role: AppRole }) {
  return <aside className="fixed inset-y-0 right-0 z-40 hidden w-[272px] flex-col border-l border-slate-200 bg-white px-4 py-5 lg:flex"><SidebarHeader /><NavigationLinks role={role} /><SidebarFooter role={role} /></aside>;
}

export function MobileSidebar({ isOpen, onClose, role }: SidebarProps) {
  const pathname = usePathname(); const previousPathname = useRef(pathname);
  useEffect(() => { if (!isOpen) return; const previousOverflow = document.body.style.overflow; document.body.style.overflow = "hidden"; const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); }; window.addEventListener("keydown", closeOnEscape); return () => { document.body.style.overflow = previousOverflow; window.removeEventListener("keydown", closeOnEscape); }; }, [isOpen, onClose]);
  useEffect(() => { if (previousPathname.current !== pathname) { previousPathname.current = pathname; onClose(); } }, [pathname, onClose]);
  if (!isOpen) return null;
  return <div className="fixed inset-0 z-[90] lg:hidden"><button type="button" aria-label="סגירת תפריט" onClick={onClose} className="absolute inset-0 z-0 cursor-default bg-slate-950/45" /><aside role="dialog" aria-modal="true" aria-label="תפריט ניווט" className="absolute inset-y-0 right-0 z-10 flex w-[min(86vw,320px)] max-w-full flex-col overflow-y-auto border-l border-slate-200 bg-white px-4 py-5 text-right shadow-2xl"><div className="flex items-center justify-between px-3"><SidebarLogo onNavigate={onClose} /><button type="button" aria-label="סגירת תפריט" onClick={onClose} className="grid size-10 shrink-0 place-items-center rounded-lg text-slate-600 hover:bg-slate-100"><Icon name="close" className="size-5" /></button></div><NavigationLinks role={role} onNavigate={onClose} /><SidebarFooter role={role} /></aside></div>;
}

function NavigationLinks({ role, onNavigate }: { role: AppRole; onNavigate?: () => void }) {
  const pathname = usePathname(); const allowedItems = navigationItemsForRole(role);
  return <nav aria-label="ניווט ראשי" className="mt-8 flex flex-1 flex-col gap-1">{allowedItems.map((item) => { const active = pathname === item.href; return <Link key={item.href} href={item.href} onClick={onNavigate} className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-right text-sm font-medium transition-colors ${active ? "bg-black text-white" : "text-slate-600 hover:bg-slate-100 hover:text-black"}`}><Icon name={item.icon} className="size-5 shrink-0" /><span>{item.label}</span></Link>; })}</nav>;
}
function SidebarHeader() { return <div className="flex items-center px-3"><SidebarLogo /></div>; }
function SidebarLogo({ onNavigate }: { onNavigate?: () => void }) { return <Link href="/dashboard" className="flex min-w-0 items-center" onClick={onNavigate}><span className="rounded-lg bg-white p-1"><Image src="/logo.png" alt="TAYO" width={550} height={303} className="h-auto w-28" priority /></span></Link>; }
function SidebarFooter({ role }: { role: AppRole }) { return <div><div className="rounded-xl bg-slate-50 p-3"><p className="text-xs font-medium text-slate-900">TAYO BAR ERP</p><p className="mt-1 text-xs leading-5 text-slate-500">מרכז התפעול שלך.</p></div><LogoutButton role={role} /></div>; }
