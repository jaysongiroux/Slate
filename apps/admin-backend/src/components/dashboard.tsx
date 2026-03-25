import React, { useEffect, useState } from "react";
import { Box, H2, H5, Text } from "@adminjs/design-system";
import { ApiClient } from "adminjs";

export type SlateDashboardStats = {
  totalUsers: number;
  totalAdmins: number;
  totalDocuments: number;
  totalAttachments: number;
  accountCreationEnabled: boolean;
  passwordAuthEnabled: boolean;
  oidcProvidersCount: number;
  oidcProvidersEnabledCount: number;
  usersWithEmbeddingConfigured: number;
  documentsQueuedForEmbedding: number;
  documentsEmbeddedIndexed: number;
};

function StatCard({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <Box
      variant="white"
      p="xl"
      boxShadow="card"
      style={{ minWidth: "168px", flex: "1 1 160px" }}
    >
      <H5 color="grey60" fontWeight="normal">
        {label}
      </H5>
      <H2 mt="sm">{value}</H2>
    </Box>
  );
}

function boolLabel(v: boolean) {
  return v ? "Yes" : "No";
}

const Dashboard: React.FC = () => {
  const [data, setData] = useState<SlateDashboardStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const api = new ApiClient();
    void api
      .getDashboard()
      .then((res) => setData(res.data as SlateDashboardStats))
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : "Failed to load dashboard";
        setError(message);
      });
  }, []);

  if (error) {
    return (
      <Box p="xl">
        <Text color="error">{error}</Text>
      </Box>
    );
  }

  if (!data) {
    return (
      <Box p="xl">
        <Text color="grey60">Loading…</Text>
      </Box>
    );
  }

  return (
    <Box px="xl" py="lg">
      <H2 mb="xl">Overview</H2>

      <H5 mb="default" color="grey60">
        Platform
      </H5>
      <Box display="flex" flexWrap="wrap" gap="lg" mb="xxl">
        <StatCard label="Users" value={data.totalUsers} />
        <StatCard label="Admins" value={data.totalAdmins} />
        <StatCard label="Documents (not deleted)" value={data.totalDocuments} />
        <StatCard label="Attachments" value={data.totalAttachments} />
        <StatCard label="Account creation open" value={boolLabel(data.accountCreationEnabled)} />
        <StatCard label="Password auth" value={boolLabel(data.passwordAuthEnabled)} />
        <StatCard label="OIDC providers" value={`${data.oidcProvidersEnabledCount} / ${data.oidcProvidersCount}`} />
      </Box>

      <H5 mb="default" color="grey60">
        Embeddings
      </H5>
      <Text mb="lg" color="grey60" fontSize="sm">
        Queued counts include only documents for users who have both an embedding provider and model
        configured (same rules as the core embedding worker).
      </Text>
      <Box display="flex" flexWrap="wrap" gap="lg">
        <StatCard label="Users with embedding configured" value={data.usersWithEmbeddingConfigured} />
        <StatCard label="Documents queued for embedding" value={data.documentsQueuedForEmbedding} />
        <StatCard label="Documents embedded (indexed)" value={data.documentsEmbeddedIndexed} />
      </Box>
    </Box>
  );
};

export default Dashboard;
