import { redirect } from "next/navigation";
import { requireOwner } from "@/lib/auth/user";
export default async function EventImportPage() { await requireOwner(); redirect("/events"); }
