import { requireCurrentUser } from "@/lib/auth/user";
import { AssistantChat } from "@/features/ai-assistant/chat";

export const metadata = { title: "Tayo AI | Tayo Bar" };
export default async function AssistantPage() {
  const { role, user } = await requireCurrentUser();
  return <AssistantChat key={`${user.id}:${role}`} role={role} userId={user.id} />;
}
