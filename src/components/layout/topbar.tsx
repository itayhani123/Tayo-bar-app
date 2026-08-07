"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { navigationItems } from "@/components/layout/navigation";
import { Icon } from "@/components/ui/icon";

export function Topbar({ onMenuClick }: { onMenuClick: () => void }) {
  const pathname = usePathname(); const currentPage = navigationItems.find((item) => item.href === pathname)?.label ?? "Tayo Bar";
  return <header className="safe-area-header sticky top-0 z-20 flex h-16 max-w-full items-center justify-between border-b border-slate-200 bg-slate-50/90 px-4 backdrop-blur lg:h-[73px] lg:px-8">
    <div className="flex min-w-0 items-center gap-3 lg:hidden"><button type="button" aria-label="פתח תפריט" onClick={onMenuClick} className="relative z-30 grid size-10 shrink-0 touch-manipulation place-items-center rounded-lg text-slate-700 hover:bg-white active:bg-slate-100"><Icon name="menu" className="size-5" /></button><Link href="/dashboard" className="flex min-w-0 items-center gap-2"><span className="grid size-8 shrink-0 place-items-center rounded-lg bg-indigo-600 text-sm font-bold text-white">T</span><span className="truncate font-semibold text-slate-950">Tayo Bar</span></Link></div>
    <div className="hidden min-w-0 lg:block"><p className="text-xs font-medium text-slate-400">סביבת עבודה</p><h1 className="truncate text-lg font-semibold tracking-tight text-slate-950">{currentPage}</h1></div>
    <div className="hidden items-center gap-3 lg:flex"><button type="button" aria-label="התראות" className="relative grid size-10 place-items-center rounded-lg text-slate-500 hover:bg-white"><Icon name="bell" className="size-5" /><span className="absolute left-2 top-2 size-1.5 rounded-full bg-indigo-600" /></button><button type="button" className="flex items-center gap-2 rounded-xl p-1 pl-2 text-right hover:bg-white"><span className="grid size-8 place-items-center rounded-lg bg-slate-900 text-xs font-semibold text-white">TB</span><span><span className="block text-sm font-medium text-slate-800">Tayo Bar</span><span className="block text-xs text-slate-500">מנהל מערכת</span></span><Icon name="chevron" className="size-4 rotate-180 text-slate-400" /></button></div>
  </header>;
}
