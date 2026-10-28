import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Handbook Assistant",
  description: "Ask questions about the Northwind Labs employee handbook.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
