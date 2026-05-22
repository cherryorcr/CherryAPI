import { CheckCircle2, Circle, KeyRound, Layers3, Route, Server } from "lucide-react";

const steps = [
  { key: "account", title: "Connect Account", hint: "Accounts > Login / Import", icon: Server },
  { key: "models", title: "Sync Models", hint: "Sync Models", icon: Layers3 },
  { key: "routes", title: "Bind Group", hint: "Groups > Model Bindings", icon: Route },
  { key: "key", title: "Create Key", hint: "API Keys", icon: KeyRound }
] as const;

export function OnboardingSteps({
  accountCount,
  capabilityCount,
  selectedPlatformName
}: {
  accountCount: number;
  capabilityCount: number;
  selectedPlatformName: string;
}) {
  const completed = {
    account: accountCount > 0,
    models: capabilityCount > 0,
    routes: false,
    key: false
  };

  return (
    <div className="rounded-lg border border-slate-200/80 bg-white/80 p-3 shadow-sm shadow-slate-900/5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-sm font-semibold text-slate-950">Account Onboarding</div>
          <div className="text-xs text-slate-500">
            {selectedPlatformName} / Complete these steps in order to use the OpenAI-compatible API
          </div>
        </div>
        <div className="text-xs text-slate-500">{accountCount} accounts / {capabilityCount} detected models</div>
      </div>
      <div className="grid gap-2 md:grid-cols-4">
        {steps.map((step) => {
          const Icon = step.icon;
          const done = completed[step.key];
          return (
            <div
              className={`grid grid-cols-[auto_minmax(0,1fr)] items-center gap-2 rounded-lg border px-3 py-2 ${
                done ? "border-emerald-200 bg-emerald-50/70" : "border-slate-200 bg-slate-50/60"
              }`}
              key={step.key}
            >
              <span className={done ? "text-emerald-700" : "text-slate-400"}>
                {done ? <CheckCircle2 size={17} /> : <Circle size={17} />}
              </span>
              <span className="min-w-0">
                <span className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
                  <Icon className="shrink-0 text-slate-500" size={15} />
                  <span className="truncate">{step.title}</span>
                </span>
                <span className="block truncate text-xs text-slate-500">{step.hint}</span>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
