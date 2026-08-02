import { createClient } from "@/lib/supabase/client";
import type { Employee, EmployeeFormValues } from "../types";

type EmployeeRow = {
  id: string;
  full_name: string;
  phone: string | null;
  default_hourly_rate: number | string;
  active: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

const toEmployee = (row: EmployeeRow): Employee => ({
  id: row.id,
  fullName: row.full_name,
  phone: row.phone ?? "",
  defaultHourlyRate: Number(row.default_hourly_rate),
  active: row.active,
  notes: row.notes ?? "",
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const toPayload = (values: EmployeeFormValues) => ({
  full_name: values.fullName.trim(),
  phone: values.phone.trim() || null,
  default_hourly_rate: values.defaultHourlyRate,
  active: values.active,
  notes: values.notes.trim() || null,
});

export async function listEmployees(): Promise<Employee[]> {
  const { data, error } = await createClient().from("employees").select("*").order("full_name");
  if (error) throw error;
  return (data as EmployeeRow[]).map(toEmployee);
}

export async function createEmployee(values: EmployeeFormValues): Promise<Employee> {
  const { data, error } = await createClient().from("employees").insert(toPayload(values)).select().single();
  if (error) throw error;
  return toEmployee(data as EmployeeRow);
}

export async function updateEmployee(id: string, values: EmployeeFormValues): Promise<Employee> {
  const { data, error } = await createClient().from("employees").update(toPayload(values)).eq("id", id).select().single();
  if (error) throw error;
  return toEmployee(data as EmployeeRow);
}

export async function setEmployeeActive(id: string, active: boolean): Promise<Employee> {
  const { data, error } = await createClient().from("employees").update({ active }).eq("id", id).select().single();
  if (error) throw error;
  return toEmployee(data as EmployeeRow);
}
