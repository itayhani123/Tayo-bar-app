import { PlaceholderPage } from "@/components/ui/placeholder-page";
import { requireOwner } from "@/lib/auth/user";

export default async function IncomePage() {
  await requireOwner();
  return <PlaceholderPage title="הכנסות" description="מעקב אחר הכנסות בתצוגה ייעודית לרשומות הכספיות." icon="income" />;
}
