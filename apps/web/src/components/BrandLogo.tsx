import { useState } from "react";

const brandIconSrc = "/brand/cherryapi-icon.png";
const brandWordmarkSrc = "/brand/cherryapi-wordmark.png";

export function CherryBrandIcon({ className = "h-11 w-11" }: { className?: string }) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <span className={`${className} inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-500`}>
        CA
      </span>
    );
  }

  return (
    <img
      alt="CherryAPI"
      className={className}
      draggable={false}
      onError={() => setFailed(true)}
      src={brandIconSrc}
    />
  );
}

export function CherryWordmark({ className = "" }: { className?: string }) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return <span className={`font-semibold tracking-normal text-slate-950 ${className}`}>CherryAPI</span>;
  }

  return (
    <img
      alt="CherryAPI"
      className={`h-8 w-auto max-w-full object-contain ${className}`}
      draggable={false}
      onError={() => setFailed(true)}
      src={brandWordmarkSrc}
    />
  );
}

export function CherryBrandLockup({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <CherryBrandIcon className="h-11 w-11 shrink-0 drop-shadow-sm" />
      {!compact && (
        <div className="min-w-0 max-lg:hidden">
          <CherryWordmark />
          <div className="mt-1 truncate text-xs font-medium text-slate-500">OpenAI-compatible gateway</div>
        </div>
      )}
    </div>
  );
}
