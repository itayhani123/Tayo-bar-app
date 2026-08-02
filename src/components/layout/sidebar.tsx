"use client";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { navigationItems } from "@/components/layout/navigation";
import { Icon } from "@/components/ui/icon";

type SidebarProps = { isOpen: boolean; onClose: () => void };

export function Sidebar({ isOpen, onClose }: SidebarProps) {
  const pathname = usePathname();

  return (
    <>

      <button aria-label="Close navigation" onClick={onClose} className={`fixed inset-0 z-30 bg-slate-950/35 transition-opacity lg:hidden ${isOpen ? "opacity-100" : "pointer-events-none opacity-0"}`} />
      <aside className={`fixed inset-y-0 left-0 z-40 flex w-[272px] -translate-x-full flex-col border-r border-slate-200 bg-white px-4 py-5 transition-transform duration-200 lg:translate-x-0 ${isOpen ? "translate-x-0" : ""}`}>
        <div className="flex items-center justify-between px-3">
          <Link href="/dashboard" className="flex items-center gap-3" onClick={onClose}>
            <span className="grid size-9 place-items-center rounded-xl bg-indigo-600 text-lg font-bold text-white">T</span>
            <span className="text-lg font-semibold tracking-tight text-slate-950">Tayo Bar</span>
          </Link>
          <button aria-label="Close navigation" onClick={onClose} className="grid size-9 place-items-center rounded-lg text-slate-500 hover:bg-slate-100 lg:hidden"><Icon name="close" className="size-5" /></button>
        </div>
        <nav aria-label="Primary navigation" className="mt-10 flex flex-1 flex-col gap-1">
          {navigationItems.map((item) => {
            const active = pathname === item.href;
            return <Link key={item.href} href={item.href} onClick={onClose} className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${active ? "bg-indigo-50 text-indigo-700" : "text-slate-600 hover:bg-slate-50 hover:text-slate-950"}`}><Icon name={item.icon} className="size-5" />{item.label}</Link>;
          })}
        </nav>
        <div className="rounded-xl bg-slate-50 p-3">
          <p className="text-xs font-medium text-slate-900">Tayo Bar ERP</p>
          <p className="mt-1 text-xs leading-5 text-slate-500">Your operations hub.</p>
        </div>
      </aside>
    </>
  );
}
