import { useEffect, useState } from 'react';

export interface ProviderStatus {
  google: boolean;
  loading: boolean;
}

export function useProviderStatus(): ProviderStatus {
  const [status, setStatus] = useState<ProviderStatus>({
    google: false,
    loading: true,
  });

  useEffect(() => {
    fetch('/api/integrations/status')
      .then((r) => r.json())
      .then((data: Record<string, { configured?: boolean }>) => {
        setStatus({
          google: !!data.google?.configured,
          loading: false,
        });
      })
      .catch(() => setStatus((s) => ({ ...s, loading: false })));
  }, []);

  return status;
}
