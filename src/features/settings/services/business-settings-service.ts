import { createClient } from "@/lib/supabase/client";
import type { BusinessSetting } from "../types";
type SettingRow = { id: string; key: string; numeric_value: number | string | null; text_value: string | null; updated_at: string };
const toSetting = (row: SettingRow): BusinessSetting => ({ id: row.id, key: row.key, numericValue: row.numeric_value === null ? null : Number(row.numeric_value), textValue: row.text_value, updatedAt: row.updated_at });
export async function getIncomeTaxAdvanceRate(): Promise<number> { const { data, error } = await createClient().from("business_settings").select("*").eq("key", "income_tax_advance_rate").single(); if (error) throw error; return toSetting(data as SettingRow).numericValue ?? 3.2; }
export async function updateIncomeTaxAdvanceRate(rate: number): Promise<void> { const { error } = await createClient().from("business_settings").update({ numeric_value: rate }).eq("key", "income_tax_advance_rate"); if (error) throw error; }
