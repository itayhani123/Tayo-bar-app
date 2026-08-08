import type { AppRole } from "@/lib/auth/user";import type { AppNotification } from "../types";
const financeTypes=new Set(["open_receivable"]);
export const unreadCount=(items:AppNotification[])=>items.filter(item=>!item.readAt).length;
export const notificationAllowedForRole=(type:string,role:AppRole)=>role==="owner"||!financeTypes.has(type);
export function dedupeNotifications(items:AppNotification[]){return [...new Map(items.map(item=>[item.id,item])).values()];}
export function markRead(items:AppNotification[],id:string,at:string){return items.map(item=>item.id===id?{...item,readAt:at}:item);}
