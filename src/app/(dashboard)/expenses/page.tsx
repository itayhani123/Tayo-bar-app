import { PlaceholderPage } from "@/components/ui/placeholder-page";
import { requireOwner } from "@/lib/auth/user";

export default async function ExpensesPage() {
  await requireOwner();
  return <PlaceholderPage title="הוצאות" description="ארגון עלויות התפעול והכנתן לתהליכי העבודה הכספיים." icon="expenses" />;
}
