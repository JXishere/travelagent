import type { Metadata, Viewport } from "next";
import { Geist_Mono } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";

const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
});

const city = (process.env.NEXT_PUBLIC_DEFAULT_CITY || "Kuala Lumpur").toLowerCase();

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0a0a0a",
};

const title = "Sam — the friend who lives everywhere";
const description = `Sam is learning ${city}. Help build the knowledge graph — tell Sam what you know.`;

export const metadata: Metadata = {
  title,
  description,
  openGraph: {
    title,
    description,
    url: "https://samiseverywhere.com",
    siteName: "Sam",
    type: "website",
  },
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
        <Analytics />
      </body>
    </html>
  );
}
