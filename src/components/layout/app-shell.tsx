"use client";
import { useCallback, useState } from "react";
import { Sidebar } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";
import type { AppRole } from "@/lib/auth/user";

export function AppShell({ children, role }: { children: React.ReactNode; role: AppRole }) { const [isSidebarOpen, setSidebarOpen] = useState(false); const closeSidebar = useCallback(() => setSidebarOpen(false), []); return <div className="min-h-screen overflow-x-clip bg-slate-50"><Sidebar role={role} isOpen={isSidebarOpen} onClose={closeSidebar} /><div className="min-h-screen lg:pr-[272px]"><Topbar onMenuClick={() => setSidebarOpen(true)} /><main className="safe-area-content px-5 py-6 lg:px-8 lg:py-8">{children}</main></div></div>; }
