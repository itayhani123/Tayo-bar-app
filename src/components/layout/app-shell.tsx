"use client";
import { useState } from "react";
import { Sidebar } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";
import type { AppRole } from "@/lib/auth/user";

export function AppShell({ children, role }: { children: React.ReactNode; role: AppRole }) { const [isSidebarOpen, setSidebarOpen] = useState(false); return <div className="min-h-screen bg-slate-50"><Sidebar role={role} isOpen={isSidebarOpen} onClose={() => setSidebarOpen(false)} /><div className="min-h-screen lg:pr-[272px]"><Topbar onMenuClick={() => setSidebarOpen(true)} /><main className="px-5 py-6 lg:px-8 lg:py-8">{children}</main></div></div>; }
