import { IncomePage } from "@/features/income";
import { requireOwner } from "@/lib/auth/user";

export default async function IncomeRoute() {
  await requireOwner();
  return <IncomePage />;
}
