"use client";

import { usePathname } from "next/navigation";
import { navigationItems } from "@/components/layout/navigation";
import { Icon } from "@/components/ui/icon";

export function Topbar({ onMenuClick }: { onMenuClick: () => void }) {
  const pathname = usePathname();
  const currentPage = navigationItems.find((item) => item.href === pathname)?.label ?? "Tayo Bar";
  return <header className="sticky top-0 z-20 flex h-[73px] items-center justify-between border-b border-slate-200 bg-slate-50/90 px-5 backdrop-blur lg:px-8">
    <div className="flex items-center gap-3"><button aria-label="פתיחת ניווט" onClick={onMenuClick} className="grid size-10 place-items-center rounded-lg text-slate-600 hover:bg-white lg:hidden"><Icon name="menu" className="size-5" /></button><div><p className="text-xs font-medium text-slate-400">סביבת עבודה</p><h1 className="text-lg font-semibold tracking-tight text-slate-950">{currentPage}</h1></div></div>
    <div className="flex items-center gap-3"><button aria-label="התראות" className="relative grid size-10 place-items-center rounded-lg text-slate-500 hover:bg-white"><Icon name="bell" className="size-5" /><span className="absolute left-2 top-2 size-1.5 rounded-full bg-indigo-600" /></button><button className="flex items-center gap-2 rounded-xl p-1 pl-2 text-right hover:bg-white"><span className="grid size-8 place-items-center rounded-lg bg-slate-900 text-xs font-semibold text-white">TB</span><span className="hidden sm:block"><span className="block text-sm font-medium text-slate-800">Tayo Bar</span><span className="block text-xs text-slate-500">מנהל מערכת</span></span><Icon name="chevron" className="hidden size-4 rotate-180 text-slate-400 sm:block" /></button></div>
  </header>;
}
