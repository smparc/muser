import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Muser · Connect your Muse",
  description: "A real onboarding and conversation API for your personal agent.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
