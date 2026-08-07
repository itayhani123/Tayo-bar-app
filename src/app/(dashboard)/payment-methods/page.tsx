import { MasterDataPage } from "@/features/master-data";
import { requireOwner } from "@/lib/auth/user";
export default async function PaymentMethodsPage() { await requireOwner(); return <MasterDataPage kind="payment_methods" />; }
