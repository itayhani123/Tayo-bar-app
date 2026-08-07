import type { Metadata, Viewport } from "next";
import "./globals.css";
import { QueryProvider } from "@/components/providers/query-provider";
import { PwaProvider } from "@/components/pwa/pwa-provider";

export const metadata: Metadata = {
  applicationName: "TAYO BAR",
  title: { default: "TAYO BAR", template: "%s | TAYO BAR" },
  description: "מערכת לניהול אירועים, עובדים וכספים",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "TAYO BAR", statusBarStyle: "default" },
  icons: {
    icon: [{ url: "/icons/favicon-32.png", sizes: "32x32", type: "image/png" }, { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
};

export const viewport: Viewport = { themeColor: "#4f46e5", viewportFit: "cover" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="he" dir="rtl" className="font-sans"><body><QueryProvider>{children}</QueryProvider><PwaProvider /></body></html>;
}
