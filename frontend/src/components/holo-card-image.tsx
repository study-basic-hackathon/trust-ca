import Image from "next/image";

export function HoloCardImage({
  src,
  alt,
  priority,
}: {
  src: string;
  alt: string;
  priority?: boolean;
}) {
  return (
    <div className="relative aspect-[3/4] overflow-hidden rounded-md bg-black/5">
      <Image
        src={src}
        alt={alt}
        fill
        priority={priority}
        sizes="(min-width: 768px) 384px, 100vw"
        className="object-contain"
      />
      {/* 常に動き続ける光のスイープ */}
      <div className="holo-shine-sweep pointer-events-none absolute inset-0" />
    </div>
  );
}
