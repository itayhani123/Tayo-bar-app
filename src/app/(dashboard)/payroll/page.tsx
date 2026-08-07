import { PayrollPage as PayrollFeaturePage } from "@/features/payroll";
import { requireOwner } from "@/lib/auth/user";

export default async function PayrollPage() {
  await requireOwner();
  return <PayrollFeaturePage />;
}
