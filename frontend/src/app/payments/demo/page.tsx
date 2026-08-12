import type { Metadata } from "next";
import Link from "next/link";
import { PaymentDemo } from "./payment-demo";
import styles from "./payment-demo.module.css";
import { PaymentProviders } from "./providers";

export const metadata: Metadata = {
  title: "JPYC決済MVP｜Trustca",
  description: "SIWE認証とchain上のreceipt検証を含むJPYC決済MVP",
};

export default function PaymentDemoPage() {
  if (!process.env.NEXT_PUBLIC_WEB3AUTH_CLIENT_ID) {
    return (
      <main className={styles.setup}>
        <p className={styles.label}>SETUP REQUIRED</p>
        <h1>ウォレット接続の設定が必要です</h1>
        <p>
          <code>NEXT_PUBLIC_WEB3AUTH_CLIENT_ID</code>を設定してfrontendを再起動してください。
          値はMetaMask Embedded Wallets Dashboardで発行します。
        </p>
        <p><Link href="/">Trustcaトップへ戻る</Link></p>
      </main>
    );
  }

  return (
    <PaymentProviders>
      <PaymentDemo />
    </PaymentProviders>
  );
}
