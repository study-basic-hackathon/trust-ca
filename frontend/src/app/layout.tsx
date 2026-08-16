import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Trustca｜信頼できるカード取引",
  description: "鑑定済みトレーディングカードのC2Cマーケットプレイス",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
