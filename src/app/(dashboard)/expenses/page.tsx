import { ExpensesPage } from "@/features/expenses";
import { requireOwner } from "@/lib/auth/user";

export default async function ExpensesRoute() {
  await requireOwner();
  return <ExpensesPage />;
}
