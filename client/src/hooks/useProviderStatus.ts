import { useEffect, useState } from 'react';

export interface ProviderStatus {
  github: boolean;
  google: boolean;
  loading: boolean;
}

export function useProviderStatus(): ProviderStatus {
  const [status, setStatus] = useState<ProviderStatus>({
    github: false,
    google: false,
    loading: true,
  });

  useEffect(() => {
    fetch('/api/integrations/status')
      .then((r) => r.json())
      .then((data: Record<string, { configured?: boolean }>) => {
        setStatus({
          github: !!data.github?.configured,
          google: !!data.google?.configured,
          loading: false,
        });
      })
      .catch(() => setStatus((s) => ({ ...s, loading: false })));
  }, []);

  return status;
}
