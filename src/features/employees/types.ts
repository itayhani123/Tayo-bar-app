export type Employee = {
  id: string;
  fullName: string;
  phone: string;
  defaultHourlyRate: number;
  active: boolean;
  notes: string;
  createdAt: string;
  updatedAt: string;
};

export type EmployeeFormValues = {
  fullName: string;
  phone: string;
  defaultHourlyRate: number;
  active: boolean;
  notes: string;
};

export type EmployeeStatusFilter = "active" | "inactive" | "all";
