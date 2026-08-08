"use client";
import { useMutation,useQuery,useQueryClient } from "@tanstack/react-query";
import { createExpense,deleteExpense,importExpenses,listExpenses,updateExpense } from "../services/expenses-service";
const key=["expenses"] as const;
export const useExpenses=()=>useQuery({queryKey:key,queryFn:listExpenses});
export function useExpenseMutations(){ const client=useQueryClient(); const done=()=>client.invalidateQueries({queryKey:key}); return { create:useMutation({mutationFn:createExpense,onSuccess:done}), update:useMutation({mutationFn:({id,values}:{id:string;values:Parameters<typeof updateExpense>[1]})=>updateExpense(id,values),onSuccess:done}), remove:useMutation({mutationFn:deleteExpense,onSuccess:done}), importRows:useMutation({mutationFn:importExpenses,onSuccess:done}) }; }
