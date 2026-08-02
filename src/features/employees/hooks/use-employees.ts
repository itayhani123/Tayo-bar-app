"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createEmployee, listEmployees, setEmployeeActive, updateEmployee } from "../services/employees-service";
import type { EmployeeFormValues } from "../types";

const employeesKey = ["employees"] as const;
const invalidate = (client: ReturnType<typeof useQueryClient>) => client.invalidateQueries({ queryKey: employeesKey });

export function useEmployees() { return useQuery({ queryKey: employeesKey, queryFn: listEmployees }); }
export function useCreateEmployee() { const client = useQueryClient(); return useMutation({ mutationFn: createEmployee, onSuccess: () => invalidate(client) }); }
export function useUpdateEmployee() { const client = useQueryClient(); return useMutation({ mutationFn: ({ id, values }: { id: string; values: EmployeeFormValues }) => updateEmployee(id, values), onSuccess: () => invalidate(client) }); }
export function useSetEmployeeActive() { const client = useQueryClient(); return useMutation({ mutationFn: ({ id, active }: { id: string; active: boolean }) => setEmployeeActive(id, active), onSuccess: () => invalidate(client) }); }
