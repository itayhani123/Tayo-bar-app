import { requireCurrentUser } from "@/lib/auth/user";
import { AssistantChat } from "@/features/ai-assistant/chat";
import { WhatsAppAttendanceInbox } from "@/features/ai-assistant/whatsapp-inbox";

export const metadata = { title: "Tayo AI | Tayo Bar" };
export default async function AssistantPage() {
  const { role, user } = await requireCurrentUser();
  const revision = process.env.VERCEL_GIT_COMMIT_SHA ?? "";
  const buildId = /^[0-9a-f]{7,64}$/i.test(revision) ? revision.slice(0,12) : "local";
  return <><AssistantChat key={`${user.id}:${role}`} role={role} userId={user.id} buildId={buildId} /><WhatsAppAttendanceInbox role={role} /></>;
}
