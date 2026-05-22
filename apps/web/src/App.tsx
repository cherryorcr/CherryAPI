import { useState } from "react";
import type { ComponentType } from "react";
import {
  Activity,
  ChevronDown,
  ChevronRight,
  Database,
  FlaskConical,
  KeyRound,
  Layers3,
  Network,
  Route,
  Search,
  Server,
  ShieldCheck,
  Users
} from "lucide-react";
import { AccountsPage } from "./pages/AccountsPage";
import { ApiKeysPage } from "./pages/ApiKeysPage";
import { ChannelsPage } from "./pages/ChannelsPage";
import { DashboardPage } from "./pages/DashboardPage";
import { GroupsPage } from "./pages/GroupsPage";
import { ModelSyncChecksPage } from "./pages/ModelSyncChecksPage";
import { ModelRoutesPage } from "./pages/ModelRoutesPage";
import { ModelsPage } from "./pages/ModelsPage";
import { ProxyPage } from "./pages/ProxyPage";
import { UsageLogsPage } from "./pages/UsageLogsPage";
import { TestConsolePage } from "./pages/TestConsolePage";
import { AdminGuide } from "./components/AdminGuide";
import { CherryBrandLockup } from "./components/BrandLogo";

type PageKey =
  | "dashboard"
  | "channels"
  | "accounts"
  | "modelSyncChecks"
  | "models"
  | "routes"
  | "groups"
  | "proxy"
  | "apiKeys"
  | "usage"
  | "test";

const pages: Array<{ key: PageKey; label: string; icon: ComponentType<{ className?: string; size?: number }> }> = [
  { key: "dashboard", label: "Dashboard", icon: Activity },
  { key: "channels", label: "Channels", icon: Network },
  { key: "accounts", label: "Accounts", icon: Server },
  { key: "modelSyncChecks", label: "Model Sync & Checks", icon: Search },
  { key: "groups", label: "Groups", icon: Users },
  { key: "proxy", label: "Proxy", icon: ShieldCheck },
  { key: "apiKeys", label: "API Keys", icon: KeyRound },
  { key: "usage", label: "Usage", icon: Database },
  { key: "test", label: "Test Console", icon: FlaskConical }
];

const advancedPages: Array<{ key: PageKey; label: string; icon: ComponentType<{ className?: string; size?: number }> }> = [
  { key: "models", label: "Models", icon: Layers3 },
  { key: "routes", label: "Routes", icon: Route }
];

function renderPage(activePage: PageKey, setActivePage: (page: PageKey) => void) {
  switch (activePage) {
    case "channels":
      return <ChannelsPage />;
    case "accounts":
      return <AccountsPage onGoToDiscovery={() => setActivePage("modelSyncChecks")} />;
    case "modelSyncChecks":
      return <ModelSyncChecksPage />;
    case "models":
      return <ModelsPage />;
    case "routes":
      return <ModelRoutesPage />;
    case "groups":
      return <GroupsPage />;
    case "proxy":
      return <ProxyPage />;
    case "apiKeys":
      return <ApiKeysPage />;
    case "usage":
      return <UsageLogsPage />;
    case "test":
      return <TestConsolePage />;
    case "dashboard":
    default:
      return <DashboardPage />;
  }
}

function navButtonClass(selected: boolean, nested = false) {
  return [
    "nav-button flex h-10 w-full items-center gap-3 rounded-lg px-3 text-left text-sm font-semibold max-lg:justify-center max-lg:px-0",
    nested ? "lg:pl-8" : "",
    selected
      ? "nav-button-active"
      : "text-slate-600 hover:border-slate-200/80 hover:bg-white/70 hover:text-slate-950 hover:shadow-sm"
  ]
    .filter(Boolean)
    .join(" ");
}

export function App() {
  const [activePage, setActivePage] = useState<PageKey>("dashboard");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const advancedSelected = advancedPages.some((page) => page.key === activePage);

  return (
    <div className="app-shell min-h-screen text-slate-950">
      <div className="flex min-h-screen">
        <aside className="sidebar-shell flex w-72 shrink-0 flex-col border-r px-4 py-5 max-lg:w-20 max-lg:px-2">
          <div className="mb-6 flex items-center gap-3 px-1 max-lg:justify-center">
            <CherryBrandLockup compact={false} />
          </div>
          <AdminGuide />
          <nav className="flex-1 space-y-1.5">
            {pages.map((page) => {
              const Icon = page.icon;
              const selected = page.key === activePage;
              return (
                <button
                  className={navButtonClass(selected)}
                  key={page.key}
                  onClick={() => setActivePage(page.key)}
                  title={page.label}
                  type="button"
                >
                  <Icon className="shrink-0" size={18} />
                  <span className="min-w-0 truncate max-lg:hidden">{page.label}</span>
                </button>
              );
            })}
          </nav>
          <div className="border-t border-slate-200/80 pt-3">
            <button
              className={navButtonClass(advancedSelected)}
              onClick={() => setAdvancedOpen((current) => !current)}
              title="Advanced"
              type="button"
            >
              {advancedOpen ? <ChevronDown className="shrink-0" size={18} /> : <ChevronRight className="shrink-0" size={18} />}
              <span className="min-w-0 truncate max-lg:hidden">Advanced</span>
            </button>
            {advancedOpen && (
              <div className="mt-1.5 space-y-1.5">
                {advancedPages.map((page) => {
                  const Icon = page.icon;
                  const selected = page.key === activePage;
                  return (
                    <button
                      className={navButtonClass(selected, true)}
                      key={page.key}
                      onClick={() => setActivePage(page.key)}
                      title={page.label}
                      type="button"
                    >
                      <Icon className="shrink-0" size={18} />
                      <span className="min-w-0 truncate max-lg:hidden">{page.label}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </aside>
        <main className="page-main min-w-0 flex-1 px-8 py-7 max-lg:px-4">{renderPage(activePage, setActivePage)}</main>
      </div>
    </div>
  );
}
