import type { Metadata } from "next";
import {
  EB_Garamond,
  Source_Serif_4,
  Space_Grotesk,
  Inconsolata,
} from "next/font/google";
import { Providers } from "@/components/providers";
import "./globals.css";

const ebGaramond = EB_Garamond({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-eb-garamond",
  display: "swap",
});

const sourceSerif = Source_Serif_4({
  subsets: ["latin"],
  weight: ["300", "400", "600", "700"],
  variable: "--font-source-serif",
  display: "swap",
});

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-space-grotesk",
  display: "swap",
});

const inconsolata = Inconsolata({
  subsets: ["latin"],
  weight: ["300", "400", "600"],
  variable: "--font-inconsolata",
  display: "swap",
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
    <html lang="en">
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap"
          rel="stylesheet"
        />
      </head>
      <body
        className={`${ebGaramond.variable} ${sourceSerif.variable} ${spaceGrotesk.variable} ${inconsolata.variable} font-source-serif bg-void text-text antialiased`}
      >
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
