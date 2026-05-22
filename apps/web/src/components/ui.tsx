import type { ComponentType, ReactNode } from "react";
import {
  Activity,
  AlertCircle,
  CheckCircle2,
  Database,
  FlaskConical,
  Inbox,
  KeyRound,
  Layers3,
  Loader2,
  Network,
  Plus,
  RefreshCw,
  Route,
  Save,
  SearchCheck,
  Server,
  ShieldCheck,
  Trash2,
  Users,
  X
} from "lucide-react";

type IconComponent = ComponentType<{ className?: string; size?: number }>;

const titleIcons: Record<string, IconComponent> = {
  Dashboard: Activity,
  Channels: Network,
  Accounts: Server,
  "Model Sync & Checks": SearchCheck,
  Models: Layers3,
  "Model Routes": Route,
  Groups: Users,
  Proxy: ShieldCheck,
  "API Keys": KeyRound,
  "Usage Logs": Database,
  "Test Console": FlaskConical
};

export function PageHeader({
  title,
  description,
  action,
  icon
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  icon?: IconComponent;
}) {
  const Icon = icon ?? titleIcons[title];

  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="flex min-w-0 items-start gap-3">
        {Icon && (
          <span className="brand-mark inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-white">
            <Icon size={21} />
          </span>
        )}
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold text-slate-950">{title}</h1>
          {description && <p className="mt-1 max-w-4xl text-sm leading-6 text-slate-500">{description}</p>}
        </div>
      </div>
      {action}
    </div>
  );
}

export function Button({
  children,
  variant = "primary",
  type = "button",
  disabled,
  onClick,
  title
}: {
  children: ReactNode;
  variant?: "primary" | "secondary" | "danger" | "ghost";
  type?: "button" | "submit";
  disabled?: boolean;
  onClick?: () => void;
  title?: string;
}) {
  const variants = {
    primary:
      "border border-transparent bg-gradient-to-r from-blue-600 to-teal-600 text-white shadow-sm shadow-blue-900/10 hover:from-blue-700 hover:to-teal-700",
    secondary:
      "border border-slate-200/80 bg-white/80 text-slate-700 shadow-sm shadow-slate-900/5 hover:border-slate-300 hover:bg-white",
    danger:
      "border border-transparent bg-gradient-to-r from-red-600 to-orange-600 text-white shadow-sm shadow-red-900/10 hover:from-red-700 hover:to-orange-700",
    ghost: "border border-transparent text-slate-500 hover:bg-slate-100/80 hover:text-slate-950"
  };

  return (
    <button
      className={`inline-flex h-9 items-center justify-center gap-2 whitespace-nowrap rounded-lg px-3 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${variants[variant]}`}
      disabled={disabled}
      onClick={onClick}
      title={title}
      type={type}
    >
      {children}
    </button>
  );
}

export function IconButton({
  children,
  label,
  variant = "ghost",
  onClick
}: {
  children: ReactNode;
  label: string;
  variant?: "ghost" | "danger";
  onClick: () => void;
}) {
  return (
    <button
      className={`inline-flex h-8 w-8 items-center justify-center rounded-lg border border-transparent transition ${
        variant === "danger"
          ? "text-red-600 hover:border-red-100 hover:bg-red-50"
          : "text-slate-500 hover:border-slate-200 hover:bg-white hover:text-slate-950"
      }`}
      onClick={onClick}
      title={label}
      type="button"
    >
      {children}
    </button>
  );
}

export function AddButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <Button onClick={onClick}>
      <Plus size={16} />
      {label}
    </Button>
  );
}

export function RefreshButton({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  return (
    <Button disabled={disabled} onClick={onClick} variant="secondary">
      <RefreshCw size={16} />
      Refresh
    </Button>
  );
}

export function SaveButton({ disabled }: { disabled?: boolean }) {
  return (
    <Button disabled={disabled} type="submit">
      {disabled ? <Loader2 className="animate-spin" size={16} /> : <Save size={16} />}
      Save
    </Button>
  );
}

export function DeleteIconButton({ onClick }: { onClick: () => void }) {
  return (
    <IconButton label="Delete" onClick={onClick} variant="danger">
      <Trash2 size={16} />
    </IconButton>
  );
}

export function CloseIconButton({ onClick }: { onClick: () => void }) {
  return (
    <IconButton label="Close" onClick={onClick}>
      <X size={16} />
    </IconButton>
  );
}

export function ErrorBanner({ message }: { message: string | null }) {
  if (!message) {
    return null;
  }

  return (
    <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-3 rounded-lg border border-red-200 bg-red-50/90 px-4 py-3 text-sm text-red-700 shadow-sm">
      <AlertCircle className="mt-0.5 shrink-0" size={17} />
      <div className="min-w-0">
        <div className="font-semibold">Request failed</div>
        <div className="mt-0.5 break-words text-red-700/90">{message}</div>
      </div>
    </div>
  );
}

export function SuccessBanner({ message }: { message: string | null }) {
  if (!message) {
    return null;
  }

  return (
    <div className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50/90 px-4 py-3 text-sm text-emerald-700 shadow-sm">
      <CheckCircle2 className="mt-0.5 shrink-0" size={16} />
      <span>{message}</span>
    </div>
  );
}

export function Panel({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <div className="overflow-hidden rounded-lg border border-slate-200/80 bg-white/80 shadow-sm shadow-slate-900/5 backdrop-blur">
      {title && <div className="border-b border-slate-200/70 bg-slate-50/70 px-4 py-3 text-sm font-semibold text-slate-800">{title}</div>}
      <div className="p-4">{children}</div>
    </div>
  );
}

export function Field({
  label,
  children,
  span = 1
}: {
  label: string;
  children: ReactNode;
  span?: 1 | 2;
}) {
  return (
    <label className={span === 2 ? "grid gap-1 md:col-span-2" : "grid gap-1"}>
      <span className="text-xs font-semibold uppercase text-slate-500">{label}</span>
      {children}
    </label>
  );
}

export const inputClass =
  "h-9 rounded-lg border border-slate-200/90 bg-white/90 px-3 text-sm text-slate-950 shadow-sm shadow-slate-900/5 outline-none transition focus:border-blue-400 focus:bg-white focus:ring-2 focus:ring-blue-500/10";

export const textareaClass =
  "min-h-24 rounded-lg border border-slate-200/90 bg-white/90 px-3 py-2 font-mono text-xs text-slate-950 shadow-sm shadow-slate-900/5 outline-none transition focus:border-blue-400 focus:bg-white focus:ring-2 focus:ring-blue-500/10";

export function EmptyState({ message }: { message: string }) {
  return (
    <div className="grid place-items-center rounded-lg border border-dashed border-slate-300 bg-slate-50/70 p-8 text-center text-sm text-slate-500">
      <div className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-white text-slate-400 shadow-sm">
        <Inbox size={19} />
      </div>
      <div className="mt-3 font-medium text-slate-600">{message}</div>
    </div>
  );
}

export function StatusPill({ value }: { value: string | boolean | null | undefined }) {
  const text = typeof value === "boolean" ? (value ? "enabled" : "disabled") : value ?? "none";
  const positive = text === "enabled" || text === "healthy" || text === "success" || text === "available" || text === "true";
  const negative = text === "disabled" || text === "error" || text === "failed" || text === "unavailable" || text === "false";
  const color = positive
    ? "border-emerald-200 bg-emerald-50 text-emerald-700 before:bg-emerald-500"
    : negative
      ? "border-red-200 bg-red-50 text-red-700 before:bg-red-500"
      : "border-amber-200 bg-amber-50 text-amber-700 before:bg-amber-500";

  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-semibold before:h-1.5 before:w-1.5 before:rounded-full ${color}`}>
      {text}
    </span>
  );
}
