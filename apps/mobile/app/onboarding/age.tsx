import { Redirect } from 'expo-router';

/** Legacy route — onboarding is now one journey route (see onboarding/index.tsx). */
export default function AgeRedirect() {
  return <Redirect href="/onboarding?step=age" />;
}
