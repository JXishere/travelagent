import type { Metadata } from "next";
import { Geist_Mono } from "next/font/google";
import "./globals.css";

const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
});

export const metadata: Metadata = {
  title: "sam — a friend who lives in every city",
  description:
    "sam is learning kuala lumpur. help build the knowledge graph — tell sam what you know.",
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
