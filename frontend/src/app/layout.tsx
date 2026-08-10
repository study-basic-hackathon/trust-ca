import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Trustca",
  description: "ポケモンカードC2Cマーケットプレイス",
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
