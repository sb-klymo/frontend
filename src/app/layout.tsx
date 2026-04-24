import type { Metadata } from "next";

import { Providers } from "@/providers/Providers";

import "./globals.css";

export const metadata: Metadata = {
  title: "Klymo",
  description: "AI conversational chatbot for booking flights and hotels via chat.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-white text-gray-900 antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
