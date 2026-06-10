import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Virtual-sim — generative agent team",
  description: "A simulated software team of generative agents",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
