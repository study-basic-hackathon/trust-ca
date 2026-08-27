"use client";

import { ShieldCheck } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/components/auth/auth-provider";
import { NotificationsBell } from "@/components/layout/notifications-bell";

function shortAddress(address?: string) {
  return address ? `${address.slice(0, 6)}…${address.slice(-4)}` : "";
}

export function Header() {
  const { isSignedIn, isBusy, walletAddress, login, logout } = useAuth();

  return (
    <header className="sticky top-0 z-40 border-b bg-card/95 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4">
        <Link href="/" className="flex items-center gap-2 font-bold text-lg">
          <ShieldCheck className="size-6 text-primary" aria-hidden />
          Trustca
        </Link>

        <nav className="flex items-center gap-1 sm:gap-2">
          <Button variant="ghost" asChild>
            <Link href="/listings">商品を探す</Link>
          </Button>
          <Button variant="ghost" asChild>
            <Link href="/sell">出品する</Link>
          </Button>

          {isSignedIn ? (
            <>
              <NotificationsBell />
              <Button variant="ghost" asChild>
                <Link href="/mypage">マイページ</Link>
              </Button>
              <span className="hidden font-mono text-xs text-muted-foreground sm:inline">
                {shortAddress(walletAddress)}
              </span>
              <Button variant="outline" size="sm" onClick={() => void logout()}>
                ログアウト
              </Button>
            </>
          ) : (
            <Button size="sm" onClick={() => void login()} disabled={isBusy}>
              {isBusy ? "ログイン中…" : "ログイン"}
            </Button>
          )}
        </nav>
      </div>
    </header>
  );
}
