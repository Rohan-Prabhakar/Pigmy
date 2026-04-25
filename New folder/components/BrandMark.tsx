"use client";

import { useState } from "react";

type BrandMarkProps = {
  name: string;
  slug: string;
  fallback: string;
};

export function BrandMark({ name, slug, fallback }: BrandMarkProps) {
  const [failed, setFailed] = useState(false);
  const src = `https://cdn.jsdelivr.net/gh/glincker/thesvg@main/public/icons/${slug}/default.svg`;

  if (failed) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-slate-800 text-xs font-semibold text-slate-200">
        {fallback}
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={`${name} logo`}
      className="h-full w-full object-contain"
      onError={() => setFailed(true)}
    />
  );
}
