import { requireOwner } from "@/lib/auth/user";import { ExpenseImportPage } from "@/features/expenses";
export default async function Page(){await requireOwner();return <ExpenseImportPage/>;}
