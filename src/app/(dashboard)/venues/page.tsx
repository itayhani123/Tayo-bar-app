import { MasterDataPage } from "@/features/master-data";
import { requireOwner } from "@/lib/auth/user";
export default async function VenuesPage() { await requireOwner(); return <MasterDataPage kind="venues" />; }
