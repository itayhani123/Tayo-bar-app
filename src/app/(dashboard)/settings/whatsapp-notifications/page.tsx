import { requireOwner } from "@/lib/auth/user";
import { WhatsAppNotificationsPage } from "@/features/settings/components/whatsapp-notifications-page";
export default async function Page() { await requireOwner(); return <WhatsAppNotificationsPage />; }
