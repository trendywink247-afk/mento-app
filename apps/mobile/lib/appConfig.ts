import { useEffect, useState } from 'react';

import { api, type AppConfig } from '@/lib/api';

/** The server's switches (GET /app-config). Everything is off until the server says
 * otherwise, and a failed read keeps it off — an optional step never blocks anyone. */
const OFF: Required<AppConfig> = {
  signup_verification_required: false,
  email_required_from_second_visit: false,
};

let cached: Required<AppConfig> | null = null;

export async function loadAppConfig(): Promise<Required<AppConfig>> {
  if (cached) return cached;
  try {
    const c = await api.appConfig();
    cached = {
      signup_verification_required: c.signup_verification_required === true,
      email_required_from_second_visit: c.email_required_from_second_visit === true,
    };
  } catch {
    return OFF;
  }
  return cached;
}

export function useAppConfig(): Required<AppConfig> {
  const [config, setConfig] = useState<Required<AppConfig>>(cached ?? OFF);
  useEffect(() => {
    let active = true;
    void loadAppConfig().then((c) => {
      if (active) setConfig(c);
    });
    return () => {
      active = false;
    };
  }, []);
  return config;
}
