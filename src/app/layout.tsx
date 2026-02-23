import type { Metadata } from "next";
import { Cinzel, Inconsolata } from "next/font/google";
import { Providers } from "@/components/providers";
import "./globals.css";

const cinzel = Cinzel({
  subsets: ["latin"],
  weight: ["400", "700", "900"],
  variable: "--font-cinzel",
});

const inconsolata = Inconsolata({
  subsets: ["latin"],
  weight: ["300", "400", "600"],
  variable: "--font-inconsolata",
});

export const metadata: Metadata = {
  title: "Hermod",
  description:
    "Swift messenger of your data. SQL reports with Excel formatting, delivered on schedule.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body
        className={`${cinzel.variable} ${inconsolata.variable} font-inconsolata bg-void text-text`}
      >
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
