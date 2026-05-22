import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { BookOpen, CheckCircle2, KeyRound, Layers3, Network, Play, Route, Server, X } from "lucide-react";
import { Button } from "./ui";

const guideSteps = [
  {
    icon: Network,
    title: "Create Or Select A Channel",
    target: "Channels / Accounts > Platform Channels",
    body: "Choose the upstream platform, base URL, adapter type, and protocol first. Common OpenAI-compatible providers can use presets."
  },
  {
    icon: Server,
    title: "Connect An Account",
    target: "Accounts > Select Platform > Login / Import Methods",
    body: "Use OAuth, JSON import, API key, or local import. After saving, CherryAPI stores encrypted credentials and account health state."
  },
  {
    icon: Layers3,
    title: "Sync Models",
    target: "Account Created > Sync Models or Account Card > Sync Models",
    body: "Auto sync fetches upstream models and verifies availability. Manual mode is useful when you only want to test selected models."
  },
  {
    icon: Route,
    title: "Bind Routes",
    target: "Groups > Model Bindings",
    body: "Bind each public model to available accounts and upstream models. Use Groups for new routing; Model Routes remains for compatibility."
  },
  {
    icon: KeyRound,
    title: "Create An API Key",
    target: "API Keys > New API Key",
    body: "Each API key must be attached to a Group. Clients only see the models and permissions exposed by that Group."
  },
  {
    icon: Play,
    title: "Run An End-To-End Test",
    target: "Test Console or /v1/chat/completions",
    body: "Send a non-streaming or streaming request with the new API key. Dashboard and Usage will show health and usage data."
  }
];

export function AdminGuide() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  return (
    <>
      <button
        className="mb-3 inline-flex h-9 w-full items-center gap-2 rounded-lg border border-slate-200 bg-white/80 px-3 text-xs font-semibold text-slate-700 shadow-sm shadow-slate-900/5 transition hover:bg-white hover:text-slate-950 max-lg:justify-center max-lg:px-0"
        onClick={() => setOpen(true)}
        title="Open setup guide"
        type="button"
      >
        <BookOpen size={15} />
        <span className="max-lg:hidden">Setup Guide</span>
      </button>

      {open &&
        createPortal(
        <div aria-modal="true" className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/35 p-4" role="dialog">
          <div className="flex max-h-[88vh] w-full max-w-4xl flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 bg-slate-50 px-5 py-4">
              <div>
                <div className="text-xs font-semibold uppercase text-slate-500">Setup Walkthrough</div>
                <h2 className="mt-1 text-lg font-semibold text-slate-950">CherryAPI Setup Flow</h2>
                <p className="mt-1 text-sm text-slate-500">Complete account onboarding, model sync, route binding, and API key testing in order. Press Esc to close at any time.</p>
              </div>
              <button
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-500 hover:bg-white hover:text-slate-950"
                onClick={() => setOpen(false)}
                title="Close"
                type="button"
              >
                <X size={17} />
              </button>
            </div>

            <div className="overflow-y-auto p-5">
              <div className="grid gap-3 md:grid-cols-2">
                {guideSteps.map((step, index) => {
                  const Icon = step.icon;
                  return (
                    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm" key={step.title}>
                      <div className="flex items-start gap-3">
                        <div className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-700 ring-1 ring-blue-100">
                          <Icon size={18} />
                        </div>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-slate-900 px-1.5 text-xs font-semibold text-white">
                              {index + 1}
                            </span>
                            <h3 className="text-sm font-semibold text-slate-950">{step.title}</h3>
                          </div>
                          <div className="mt-2 inline-flex max-w-full items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700">
                            <CheckCircle2 size={13} />
                            <span className="truncate" title={step.target}>
                              Open: {step.target}
                            </span>
                          </div>
                          <p className="mt-2 text-sm leading-6 text-slate-600">{step.body}</p>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="flex justify-end border-t border-slate-200 bg-slate-50 px-5 py-3">
              <Button onClick={() => setOpen(false)} variant="secondary">
                Close
              </Button>
            </div>
          </div>
        </div>,
          document.body
        )}
    </>
  );
}
