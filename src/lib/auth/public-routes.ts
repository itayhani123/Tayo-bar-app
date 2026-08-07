export const UNAUTHENTICATED_SERVER_ROUTES = [
  "/api/cron/whatsapp-notifications",
  "/api/webhooks/whatsapp",
] as const;

export function isUnauthenticatedServerRoute(pathname: string) {
  return UNAUTHENTICATED_SERVER_ROUTES.some((route) => pathname === route);
}
