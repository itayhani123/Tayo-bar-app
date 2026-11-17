import {createClient} from "@/lib/supabase/server";
import {createAdminClient} from "@/lib/supabase/admin";
import {handleInventory} from "@/features/inventory/http";
export const runtime="nodejs";
export function GET(request:Request){return handleInventory(request,{client:createClient,admin:createAdminClient});}
export function POST(request:Request){return handleInventory(request,{client:createClient,admin:createAdminClient});}
