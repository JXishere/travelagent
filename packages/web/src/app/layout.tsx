import type { Metadata, Viewport } from "next";
import { Geist_Mono } from "next/font/google";
import "./globals.css";

const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
});

const city = (process.env.NEXT_PUBLIC_DEFAULT_CITY || "Kuala Lumpur").toLowerCase();

export const viewport: Viewport = {
  viewportFit: "cover",
};

export const metadata: Metadata = {
  title: "Sam — the friend who lives everywhere",
  description: `Sam is learning ${city}. Help build the knowledge graph — tell Sam what you know.`,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body
        className={`${geistMono.variable} font-mono antialiased`}
        style={{ backgroundColor: "var(--bg)", color: "var(--fg)" }}
      >
        {children}
      </body>
    </html>
  );
}
