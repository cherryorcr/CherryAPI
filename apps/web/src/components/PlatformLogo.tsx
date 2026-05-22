import { Braces, Layers3 } from "lucide-react";
import type { PlatformId } from "@cherryapi/shared";
import antigravityIcon from "../assets/platforms/antigravity.svg";
import codebuddyIcon from "../assets/platforms/codebuddy.png";
import codexIcon from "../assets/platforms/codex.svg";
import cursorIcon from "../assets/platforms/cursor.svg";
import geminiIcon from "../assets/platforms/gemini.svg";
import githubCopilotIcon from "../assets/platforms/github-copilot.svg";
import kiroIcon from "../assets/platforms/kiro-menu.svg";
import qoderIcon from "../assets/platforms/qoder.png";
import traeIcon from "../assets/platforms/trae.png";
import windsurfIcon from "../assets/platforms/windsurf.svg";
import workbuddyIcon from "../assets/platforms/workbuddy.png";
import zedIcon from "../assets/platforms/zed.png";

type LogoSize = "xs" | "sm" | "md" | "lg";

const logoByPlatformId: Partial<Record<PlatformId | "all" | "workbuddy", string>> = {
  all: "",
  antigravity: antigravityIcon,
  codex: codexIcon,
  zed: zedIcon,
  github_copilot: githubCopilotIcon,
  windsurf: windsurfIcon,
  kiro: kiroIcon,
  cursor: cursorIcon,
  gemini_cli: geminiIcon,
  codebuddy: codebuddyIcon,
  codebuddy_cn: codebuddyIcon,
  qoder: qoderIcon,
  trae: traeIcon,
  openai: codexIcon,
  workbuddy: workbuddyIcon
};

const sizeClass: Record<LogoSize, string> = {
  xs: "h-6 w-6",
  sm: "h-8 w-8",
  md: "h-10 w-10",
  lg: "h-12 w-12"
};

const imageSizeClass: Record<LogoSize, string> = {
  xs: "h-4 w-4",
  sm: "h-5 w-5",
  md: "h-6 w-6",
  lg: "h-8 w-8"
};

const textSizeClass: Record<LogoSize, string> = {
  xs: "text-[0.6rem]",
  sm: "text-xs",
  md: "text-sm",
  lg: "text-base"
};

function normalizedPlatformId(platformId?: string | null): PlatformId | "all" | "workbuddy" | undefined {
  if (!platformId) return undefined;
  const normalized = platformId.replace(/-/g, "_").toLowerCase();
  if (normalized === "all") return "all";
  if (normalized === "github_copilot" || normalized === "copilot") return "github_copilot";
  if (normalized === "gemini") return "gemini_cli";
  if (normalized === "anthropic") return "claude";
  if (normalized === "workbuddy") return "workbuddy";
  return normalized as PlatformId;
}

function initials(label?: string, platformId?: string | null): string {
  const source = label?.trim() || platformId?.trim() || "AI";
  const words = source
    .replace(/compatible/i, "compat")
    .split(/[\s_-]+/)
    .filter(Boolean);
  if (words.length >= 2) {
    return `${words[0][0]}${words[1][0]}`.toUpperCase();
  }
  return source.slice(0, 2).toUpperCase();
}

function FallbackLogo({
  platformId,
  label,
  size
}: {
  platformId?: string | null;
  label?: string;
  size: LogoSize;
}) {
  const normalized = normalizedPlatformId(platformId);
  if (normalized === "all") {
    return <Layers3 className={imageSizeClass[size]} />;
  }
  if (normalized === "openai_compatible") {
    return <Braces className={imageSizeClass[size]} />;
  }
  if (normalized === "claude") {
    return <span className={`font-serif font-semibold text-orange-700 ${textSizeClass[size]}`}>C</span>;
  }
  return <span className={`font-semibold ${textSizeClass[size]}`}>{initials(label, platformId)}</span>;
}

export function PlatformLogo({
  platformId,
  label,
  size = "md",
  selected = false,
  className = ""
}: {
  platformId?: string | null;
  label?: string;
  size?: LogoSize;
  selected?: boolean;
  className?: string;
}) {
  const normalized = normalizedPlatformId(platformId);
  const src = normalized ? logoByPlatformId[normalized] : undefined;

  return (
    <span
      aria-hidden="true"
      className={[
        "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-lg border shadow-sm",
        selected ? "border-white/25 bg-white text-slate-950" : "border-slate-200 bg-white text-slate-700",
        sizeClass[size],
        className
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {src ? (
        <img alt="" className={`${imageSizeClass[size]} object-contain`} draggable={false} src={src} />
      ) : (
        <FallbackLogo label={label} platformId={platformId} size={size} />
      )}
    </span>
  );
}
