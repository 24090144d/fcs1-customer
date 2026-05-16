import type { Metadata } from "next";
import "./globals.css";
import { I18nProvider } from "@/components/layout/I18nProvider";

export const metadata: Metadata = {
  title: "FCS1 Dashboard",
  description: "Enterprise incident management analytics — upload, explore, and report.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-parchment-100 antialiased">
        <I18nProvider>{children}</I18nProvider>
      </body>
    </html>
  );
}
