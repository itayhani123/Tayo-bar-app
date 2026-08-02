import { createClient } from "@/lib/supabase/client";
import type { MasterDataInput, MasterDataKind, MasterDataRecord } from "../types";

type DatabaseRow = { id: string; name: string; created_at: string; updated_at: string };
const toRecord = (row: DatabaseRow): MasterDataRecord => ({ id: row.id, name: row.name, createdAt: row.created_at, updatedAt: row.updated_at });

export async function listMasterData(kind: MasterDataKind): Promise<MasterDataRecord[]> {
  const { data, error } = await createClient().from(kind).select("*").order("name");
  if (error) throw error;
  return (data as DatabaseRow[]).map(toRecord);
}
export async function createMasterData(kind: MasterDataKind, input: MasterDataInput): Promise<MasterDataRecord> {
  const { data, error } = await createClient().from(kind).insert({ name: input.name.trim() }).select().single();
  if (error) throw error;
  return toRecord(data as DatabaseRow);
}
export async function updateMasterData(kind: MasterDataKind, id: string, input: MasterDataInput): Promise<MasterDataRecord> {
  const { data, error } = await createClient().from(kind).update({ name: input.name.trim() }).eq("id", id).select().single();
  if (error) throw error;
  return toRecord(data as DatabaseRow);
}
export async function deleteMasterData(kind: MasterDataKind, id: string): Promise<void> {
  const { error } = await createClient().from(kind).delete().eq("id", id);
  if (error) throw error;
}
