import { MasterDataPage } from "@/features/master-data";
import { requireOwner } from "@/lib/auth/user";
export default async function BarPackagesPage() { await requireOwner(); return <MasterDataPage kind="bar_packages" />; }
