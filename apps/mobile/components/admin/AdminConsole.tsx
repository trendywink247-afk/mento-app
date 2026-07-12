import { WebOnlyNotice } from '@/components/listener/WebOnlyNotice';

/** Native stub — metro resolves AdminConsole.web.tsx on web. The admin dashboard
 * is web-only (an ops tool), same as the listener console. */
export default function AdminConsole() {
  return <WebOnlyNotice />;
}
