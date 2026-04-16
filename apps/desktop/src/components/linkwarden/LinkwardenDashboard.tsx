import { useCallback, useEffect, useState } from "react";
import { motion } from "motion/react";
import { Loader2 } from "lucide-react";
import type { LinkwardenLink } from "@slate/shared";
import { getLinkwardenDashboard } from "../../lib/api";
import { LinkwardenLinkItem } from "./LinkwardenLinkItem";

interface DashboardData {
  data: {
    links: LinkwardenLink[];
    numberOfPinnedLinks: number;
    numberOfTags: number;
  };
}

interface LinkwardenDashboardProps {
  instanceId: string;
}

export function LinkwardenDashboard({ instanceId }: LinkwardenDashboardProps) {
  const [links, setLinks] = useState<LinkwardenLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDashboard = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = (await getLinkwardenDashboard({ instanceId })) as DashboardData;
      setLinks(result.data?.links ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load dashboard");
    } finally {
      setLoading(false);
    }
  }, [instanceId]);

  useEffect(() => {
    void fetchDashboard();
  }, [fetchDashboard]);

  if (loading) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center">
        <Loader2 size={18} className="animate-spin text-faint" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center px-6 text-center">
        <p className="m-0 text-[0.82rem] text-foreground/40">{error}</p>
      </div>
    );
  }

  if (links.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center text-[0.82rem] text-faint">
        No recent activity.
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2, ease: "easeOut" }}
      className="flex min-w-0 flex-col gap-1 overflow-hidden px-4 py-3 pb-8"
    >
      <h3 className="m-0 mb-1 text-[0.72rem] font-semibold uppercase tracking-[0.08em] text-faint select-none">
        Recent
      </h3>
      <div className="flex flex-col gap-px">
        {links.map((link) => (
          <LinkwardenLinkItem key={link.id} link={link} instanceId={instanceId} />
        ))}
      </div>
    </motion.div>
  );
}
