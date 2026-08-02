import type { Metadata } from "next";
import "./globals.css";
import { QueryProvider } from "@/components/providers/query-provider";

export const metadata: Metadata = {
  title: "Tayo Bar ERP",
  description: "ניהול תפעול, עובדים וכספים במקום אחד.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="he" dir="rtl" className="font-sans">
      <body><QueryProvider>{children}</QueryProvider></body>
    </html>
  );
}
