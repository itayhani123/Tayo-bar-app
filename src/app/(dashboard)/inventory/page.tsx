import {requireCurrentUser} from "@/lib/auth/user";
import {InventoryPage} from "@/features/inventory/page";
export default async function Page({searchParams}:{searchParams:Promise<{event?:string}>}){await requireCurrentUser();const params=await searchParams;return <InventoryPage initialEvent={params.event||""}/>;}
