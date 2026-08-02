import { Icon } from "@/components/ui/icon";
import type { NavigationItem } from "@/components/layout/navigation";

export function PlaceholderPage({ title, description, icon }: { title: string; description: string; icon: NavigationItem["icon"] }) {
  return <section className="mx-auto flex min-h-[calc(100vh-185px)] max-w-5xl items-center justify-center"><div className="w-full max-w-xl rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm sm:p-12"><span className="mx-auto grid size-14 place-items-center rounded-2xl bg-indigo-50 text-indigo-600"><Icon name={icon} className="size-7" /></span><p className="mt-7 text-xs font-semibold uppercase tracking-[0.16em] text-indigo-600">Tayo Bar ERP</p><h2 className="mt-3 text-2xl font-semibold tracking-tight text-slate-950 sm:text-3xl">{title}</h2><p className="mx-auto mt-3 max-w-md text-sm leading-6 text-slate-500">{description}</p><div className="mt-8 border-t border-slate-100 pt-6 text-sm text-slate-400">סביבת העבודה מוכנה ליכולת הבאה.</div></div></section>;
}
