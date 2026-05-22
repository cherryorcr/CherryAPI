import type { ReactNode } from "react";
import type { AccountRecord } from "../../types/admin";
import { formatDate } from "../helpers";

function formatQuotaNumber(value: number | null | undefined): string | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  return new Intl.NumberFormat("en", {
    notation: value >= 1000 ? "compact" : "standard",
    maximumFractionDigits: value >= 1000 ? 1 : 0
  }).format(value);
}

function quotaRemainingPercent(metric: NonNullable<AccountRecord["quotaSnapshot"]>["metrics"][number]): number | null {
  if (metric.included || metric.unlimited) {
    return 100;
  }
  if (typeof metric.remainingPercent === "number" && Number.isFinite(metric.remainingPercent)) {
    return Math.max(0, Math.min(100, Math.round(metric.remainingPercent)));
  }
  if (typeof metric.usedPercent === "number" && Number.isFinite(metric.usedPercent)) {
    return Math.max(0, Math.min(100, 100 - Math.round(metric.usedPercent)));
  }
  if (
    typeof metric.remaining === "number" &&
    Number.isFinite(metric.remaining) &&
    typeof metric.limit === "number" &&
    Number.isFinite(metric.limit) &&
    metric.limit > 0
  ) {
    return Math.max(0, Math.min(100, Math.round((metric.remaining / metric.limit) * 100)));
  }
  return null;
}

function quotaMetricValue(metric: NonNullable<AccountRecord["quotaSnapshot"]>["metrics"][number]): string {
  if (metric.included || metric.unlimited) {
    return "Included";
  }

  const remaining = formatQuotaNumber(metric.remaining);
  const limit = formatQuotaNumber(metric.limit);
  if (remaining && limit) {
    return `${remaining}/${limit} left`;
  }

  const remainingPercent = quotaRemainingPercent(metric);
  if (remainingPercent !== null) {
    return `${remainingPercent}% left`;
  }

  return "-";
}

function quotaRemainingBarColor(remainingPercent: number): string {
  if (remainingPercent <= 20) return "bg-red-500";
  if (remainingPercent <= 50) return "bg-amber-500";
  return "bg-emerald-500";
}

export function AccountQuotaPanel({
  account,
  compact = false,
  checking = false
}: {
  account: AccountRecord;
  compact?: boolean;
  checking?: boolean;
}) {
  const snapshot = account.quotaSnapshot;
  if (!snapshot) {
    return (
      <div className={account.quotaLastError ? "text-xs text-red-600" : "text-xs text-zinc-500"}>
        {checking ? "Checking..." : account.quotaLastError ?? "Not checked"}
      </div>
    );
  }

  const metrics = compact ? snapshot.metrics.slice(0, 2) : snapshot.metrics;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-500">
        <span>{snapshot.plan ?? snapshot.provider}</span>
        <span>{checking ? "Refreshing..." : formatDate(account.quotaCheckedAt ?? snapshot.checkedAt)}</span>
      </div>
      {metrics.length === 0 ? (
        <div className="text-xs text-zinc-500">No upstream quota data</div>
      ) : (
        <div className="space-y-2">
          {metrics.map((metric) => {
            const remainingPercent = quotaRemainingPercent(metric);
            return (
              <div key={metric.id}>
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="truncate text-zinc-500" title={metric.label}>
                    {metric.label}
                  </span>
                  <span className="shrink-0 font-medium text-zinc-900">{quotaMetricValue(metric)}</span>
                </div>
                {remainingPercent !== null && (
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-zinc-200">
                    <div className={`h-full transition-all ${quotaRemainingBarColor(remainingPercent)}`} style={{ width: `${remainingPercent}%` }} />
                  </div>
                )}
                {!compact && metric.resetAt && <div className="mt-1 text-xs text-zinc-400">Reset {formatDate(metric.resetAt)}</div>}
              </div>
            );
          })}
        </div>
      )}
      {account.quotaLastError && (
        <div className="truncate text-xs text-red-600" title={account.quotaLastError}>
          {account.quotaLastError}
        </div>
      )}
    </div>
  );
}

export function ActionTagButton({
  children,
  disabled,
  icon,
  onClick,
  title,
  variant = "neutral"
}: {
  children: ReactNode;
  disabled?: boolean;
  icon?: ReactNode;
  onClick: () => void;
  title?: string;
  variant?: "neutral" | "primary" | "danger";
}) {
  const variants = {
    neutral: "border-zinc-200 bg-white text-zinc-600 hover:border-zinc-300 hover:bg-zinc-50 hover:text-zinc-950",
    primary: "border-blue-600 bg-blue-600 text-white hover:bg-blue-700",
    danger: "border-red-200 bg-red-50 text-red-700 hover:border-red-300 hover:bg-red-100"
  };

  return (
    <button
      className={`inline-flex h-7 items-center justify-center gap-1.5 rounded-full border px-2.5 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${variants[variant]}`}
      disabled={disabled}
      onClick={onClick}
      title={title}
      type="button"
    >
      {icon}
      <span>{children}</span>
    </button>
  );
}

export function DetailItem({ label, value, span = false }: { label: string; value: ReactNode; span?: boolean }) {
  return (
    <div className={span ? "rounded-md border border-zinc-200 p-3 sm:col-span-2 lg:col-span-3" : "rounded-md border border-zinc-200 p-3"}>
      <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">{label}</div>
      <div className="mt-1 break-words text-sm text-zinc-900">{value || "-"}</div>
    </div>
  );
}
