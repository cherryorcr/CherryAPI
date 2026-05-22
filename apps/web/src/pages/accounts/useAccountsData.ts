import { useEffect, useState } from "react";
import { apiGet } from "../../api/client";
import type {
  AccountModelCapabilityRecord,
  AccountRecord,
  ChannelRecord,
  PlatformRecord,
  PlatformSummary
} from "../../types/admin";

export function useAccountsData() {
  const [accounts, setAccounts] = useState<AccountRecord[]>([]);
  const [channels, setChannels] = useState<ChannelRecord[]>([]);
  const [platforms, setPlatforms] = useState<PlatformRecord[]>([]);
  const [platformSummaries, setPlatformSummaries] = useState<PlatformSummary[]>([]);
  const [capabilities, setCapabilities] = useState<AccountModelCapabilityRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const [nextAccounts, nextChannels, nextPlatforms, nextSummaries, nextCapabilities] = await Promise.all([
        apiGet<AccountRecord[]>("/admin/accounts"),
        apiGet<ChannelRecord[]>("/admin/channels"),
        apiGet<PlatformRecord[]>("/admin/platforms"),
        apiGet<PlatformSummary[]>("/admin/platforms/summary"),
        apiGet<AccountModelCapabilityRecord[]>("/admin/account-model-capabilities")
      ]);
      setAccounts(nextAccounts);
      setChannels(nextChannels);
      setPlatforms(nextPlatforms);
      setPlatformSummaries(nextSummaries);
      setCapabilities(nextCapabilities);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  return {
    accounts,
    setAccounts,
    channels,
    setChannels,
    platforms,
    setPlatforms,
    platformSummaries,
    setPlatformSummaries,
    capabilities,
    setCapabilities,
    error,
    setError,
    loading,
    setLoading,
    load
  };
}
