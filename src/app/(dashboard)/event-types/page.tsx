import { MasterDataPage } from "@/features/master-data";
import { requireOwner } from "@/lib/auth/user";
export default async function EventTypesPage() { await requireOwner(); return <MasterDataPage kind="event_types" />; }
