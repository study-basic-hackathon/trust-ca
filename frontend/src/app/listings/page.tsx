"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { PackageSearch, Search } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { AmountJpy } from "@/components/amount-jpy";
import { EmptyState } from "@/components/empty-state";
import { TrustBadge } from "@/components/trust-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  fetchListings,
  type ListingSort,
  type ListingSummary,
} from "@/lib/api/listings";

function ListingCard({ listing }: { listing: ListingSummary }) {
  return (
    <Link href={`/listings/${listing.id}`} className="group">
      <Card className="h-full transition-shadow group-hover:shadow-md">
        <CardContent className="space-y-3 pt-6">
          <div className="flex aspect-[4/3] items-center justify-center rounded-md bg-secondary">
            <PackageSearch
              className="size-10 text-muted-foreground/40"
              aria-hidden
            />
          </div>
          <p className="line-clamp-2 font-semibold">{listing.title}</p>
          <div className="flex flex-wrap gap-1.5">
            {listing.seller.isVerified && (
              <TrustBadge signal="seller_verified" />
            )}
            {listing.card.psaVerificationStatus === "verified" && (
              <TrustBadge signal="psa_verified" />
            )}
          </div>
          <div className="flex items-center justify-between">
            <AmountJpy amountMinor={listing.priceMinor} className="text-lg" />
            <span className="text-xs text-muted-foreground">
              {listing.seller.displayName}
            </span>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

export default function ListingsPage() {
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [psaOnly, setPsaOnly] = useState(false);
  const [minPriceInput, setMinPriceInput] = useState("");
  const [maxPriceInput, setMaxPriceInput] = useState("");
  const [priceRange, setPriceRange] = useState<{ min?: string; max?: string }>(
    {},
  );
  const [sort, setSort] = useState<ListingSort>("new");

  const listingsQuery = useInfiniteQuery({
    queryKey: ["listings", search, psaOnly, priceRange, sort],
    queryFn: ({ pageParam }) =>
      fetchListings({
        search,
        psaOnly,
        cursor: pageParam,
        minPrice: priceRange.min,
        maxPrice: priceRange.max,
        sort,
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  });

  const items =
    listingsQuery.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <main className="mx-auto max-w-6xl space-y-6 px-4 py-10">
      <h1 className="text-2xl font-bold">商品を探す</h1>

      <form
        className="flex flex-wrap items-center gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          setSearch(searchInput.trim());
          setPriceRange({
            min: /^[0-9]+$/.test(minPriceInput.trim())
              ? minPriceInput.trim()
              : undefined,
            max: /^[0-9]+$/.test(maxPriceInput.trim())
              ? maxPriceInput.trim()
              : undefined,
          });
        }}
      >
        <div className="relative min-w-64 flex-1">
          <Search
            className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="カード名・タイトルで検索"
            className="pl-9"
          />
        </div>
        <div className="flex items-center gap-1.5">
          <Input
            value={minPriceInput}
            onChange={(event) => setMinPriceInput(event.target.value)}
            placeholder="下限"
            inputMode="numeric"
            className="w-24"
            aria-label="価格下限(JPYC)"
          />
          <span className="text-muted-foreground">〜</span>
          <Input
            value={maxPriceInput}
            onChange={(event) => setMaxPriceInput(event.target.value)}
            placeholder="上限"
            inputMode="numeric"
            className="w-24"
            aria-label="価格上限(JPYC)"
          />
        </div>
        <Select
          value={sort}
          onValueChange={(value) => setSort(value as ListingSort)}
        >
          <SelectTrigger className="w-36" aria-label="並び順">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="new">新着順</SelectItem>
            <SelectItem value="price_asc">価格が安い順</SelectItem>
            <SelectItem value="price_desc">価格が高い順</SelectItem>
          </SelectContent>
        </Select>
        <div className="flex items-center gap-2">
          <Checkbox
            id="psaOnly"
            checked={psaOnly}
            onCheckedChange={(checked) => setPsaOnly(checked === true)}
          />
          <Label htmlFor="psaOnly" className="font-normal">
            PSA鑑定済みのみ
          </Label>
        </div>
        <Button type="submit" variant="secondary">
          検索
        </Button>
      </form>

      {listingsQuery.isPending && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, index) => (
            <Skeleton key={index} className="h-64 w-full" />
          ))}
        </div>
      )}

      {listingsQuery.isError && (
        <Alert variant="destructive">
          <AlertTitle>商品一覧を取得できませんでした</AlertTitle>
          <AlertDescription>
            {listingsQuery.error instanceof Error
              ? listingsQuery.error.message
              : "時間をおいて再度お試しください。"}
            <Button
              variant="outline"
              size="sm"
              className="mt-2"
              onClick={() => void listingsQuery.refetch()}
            >
              再試行
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {listingsQuery.isSuccess && items.length === 0 && (
        <EmptyState
          icon={PackageSearch}
          title="条件に合う商品がありません"
          description="検索条件を変更するか、新着の出品をお待ちください。"
        />
      )}

      {items.length > 0 && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {items.map((listing) => (
              <ListingCard key={listing.id} listing={listing} />
            ))}
          </div>
          {listingsQuery.hasNextPage && (
            <div className="text-center">
              <Button
                variant="outline"
                onClick={() => void listingsQuery.fetchNextPage()}
                disabled={listingsQuery.isFetchingNextPage}
              >
                {listingsQuery.isFetchingNextPage ? "読み込み中…" : "もっと見る"}
              </Button>
            </div>
          )}
        </>
      )}
    </main>
  );
}
