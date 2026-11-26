export const UNAUTHENTICATED_SERVER_ROUTES = [
  "/api/cron/whatsapp-notifications",
  "/api/cron/whatsapp-ai",
  "/api/webhooks/whatsapp",
  "/offline",
  "/privacy",
] as const;

export function isUnauthenticatedServerRoute(pathname: string) {
  return UNAUTHENTICATED_SERVER_ROUTES.some((route) => pathname === route);
}
