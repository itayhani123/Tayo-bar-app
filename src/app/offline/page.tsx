"use client";

import Image from "next/image";

export default function OfflinePage() {
  return <main className="grid min-h-dvh place-items-center bg-slate-50 px-6 text-center" dir="rtl"><section className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-sm"><Image src="/logo.png" alt="TAYO BAR" width={220} height={121} className="mx-auto mb-6 h-auto w-44" priority /><h1 className="text-2xl font-bold text-slate-950">אין חיבור לאינטרנט</h1><p className="mt-3 text-sm leading-6 text-slate-600">כדי לצפות בנתונים העדכניים יש להתחבר לאינטרנט.</p><button type="button" onClick={() => window.location.reload()} className="mt-6 h-10 rounded-lg bg-indigo-600 px-5 text-sm font-medium text-white hover:bg-indigo-700">נסה שוב</button></section></main>;
}
