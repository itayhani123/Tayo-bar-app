"use client";

import { useEffect, useState } from "react";

interface BeforeInstallPromptEvent extends Event { prompt(): Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }> }
interface NavigatorWithStandalone extends Navigator { standalone?: boolean }
const DISMISS_KEY = "tayo-pwa-install-dismissed-at";
const DISMISS_FOR_MS = 30 * 24 * 60 * 60 * 1000;

function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches || Boolean((navigator as NavigatorWithStandalone).standalone);
}

export function PwaProvider() {
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showIosHelp, setShowIosHelp] = useState(false);
  const [isOffline, setIsOffline] = useState(false);
  const [waitingWorker, setWaitingWorker] = useState<ServiceWorker | null>(null);

  useEffect(() => {
    const dismissedAt = Number(window.localStorage.getItem(DISMISS_KEY) ?? 0);
    const maySuggestInstall = !isStandalone() && Date.now() - dismissedAt > DISMISS_FOR_MS;
    const ua = navigator.userAgent;
    setShowIosHelp(maySuggestInstall && /iPhone|iPad|iPod/.test(ua) && /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua));
    setIsOffline(!navigator.onLine);
    const onInstallPrompt = (event: Event) => { event.preventDefault(); if (maySuggestInstall) setInstallPrompt(event as BeforeInstallPromptEvent); };
    const onOnline = () => setIsOffline(false);
    const onOffline = () => setIsOffline(true);
    window.addEventListener("beforeinstallprompt", onInstallPrompt);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);

    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      const register = () => navigator.serviceWorker.register("/sw.js", { scope: "/" }).then((registration) => {
        if (registration.waiting) setWaitingWorker(registration.waiting);
        registration.addEventListener("updatefound", () => {
          const worker = registration.installing;
          worker?.addEventListener("statechange", () => { if (worker.state === "installed" && navigator.serviceWorker.controller) setWaitingWorker(worker); });
        });
      }).catch((error: unknown) => console.error("PWA registration failed", error));
      window.addEventListener("load", register, { once: true });
    }
    return () => { window.removeEventListener("beforeinstallprompt", onInstallPrompt); window.removeEventListener("online", onOnline); window.removeEventListener("offline", onOffline); };
  }, []);

  const dismissInstall = () => { window.localStorage.setItem(DISMISS_KEY, String(Date.now())); setInstallPrompt(null); setShowIosHelp(false); };
  const install = async () => { if (!installPrompt) return; await installPrompt.prompt(); await installPrompt.userChoice; setInstallPrompt(null); };
  const applyUpdate = () => { if (!waitingWorker) return; navigator.serviceWorker.addEventListener("controllerchange", () => window.location.reload(), { once: true }); waitingWorker.postMessage({ type: "SKIP_WAITING" }); };

  return <>{isOffline && <div role="status" className="fixed inset-x-0 top-0 z-[100] bg-amber-600 px-4 py-2 text-center text-sm font-medium text-white">אין חיבור לאינטרנט — פעולות שמירה אינן זמינות</div>}{waitingWorker && <aside className="fixed inset-x-4 bottom-[max(1rem,env(safe-area-inset-bottom))] z-[90] mx-auto flex max-w-md items-center justify-between gap-3 rounded-xl bg-slate-950 p-3 text-sm text-white shadow-xl"><span>גרסה חדשה זמינה</span><button type="button" onClick={applyUpdate} className="rounded-lg bg-white px-3 py-2 font-medium text-slate-950">רענן עכשיו</button></aside>}{(installPrompt || showIosHelp) && !waitingWorker && <aside className="fixed inset-x-4 bottom-[max(1rem,env(safe-area-inset-bottom))] z-[80] mx-auto max-w-md rounded-2xl border border-slate-200 bg-white p-4 text-right shadow-xl"><div className="flex items-start justify-between gap-4"><div><h2 className="font-semibold text-slate-950">התקנת TAYO</h2><p className="mt-1 text-sm leading-6 text-slate-600">{showIosHelp ? "להתקנת האפליקציה באייפון: לחץ על כפתור השיתוף ובחר ״הוסף למסך הבית״." : "התקינו את המערכת לגישה מהירה ממסך הבית."}</p></div><button type="button" aria-label="סגור הצעת התקנה" onClick={dismissInstall} className="text-xl leading-none text-slate-500">×</button></div>{installPrompt && <button type="button" onClick={install} className="mt-3 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white">התקן אפליקציה</button>}</aside>}</>;
}
