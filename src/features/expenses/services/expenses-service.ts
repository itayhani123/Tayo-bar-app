import type { Expense, ExpenseFormValues, ExpensesResponse } from "../types";
async function json<T>(response:Response):Promise<T>{ const body=await response.json() as T|{error?:string}; if(!response.ok)throw new Error((body as {error?:string}).error??"הפעולה נכשלה"); return body as T; }
export const listExpenses=()=>fetch("/api/expenses").then(response=>json<ExpensesResponse>(response));
export const createExpense=(values:ExpenseFormValues)=>fetch("/api/expenses",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(values)}).then(response=>json<Expense[]>(response));
export const importExpenses=(values:ExpenseFormValues[])=>fetch("/api/expenses",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(values)}).then(response=>json<Expense[]>(response));
export const updateExpense=(id:string,values:ExpenseFormValues)=>fetch("/api/expenses",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({id,values})}).then(response=>json<Expense>(response));
export async function deleteExpense(id:string){ const response=await fetch(`/api/expenses?id=${encodeURIComponent(id)}`,{method:"DELETE"}); if(!response.ok)throw new Error((await response.json() as {error?:string}).error??"המחיקה נכשלה"); }
