import { PlaceholderPage } from "@/components/ui/placeholder-page";
import { requireOwner } from "@/lib/auth/user";

export default async function AssistantPage() {
  await requireOwner();
  return <PlaceholderPage title="עוזר AI" description="מרחב חכם להכוונה, תשובות וסיוע תפעולי." icon="assistant" />;
}
