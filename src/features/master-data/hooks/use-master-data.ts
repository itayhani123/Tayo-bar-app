"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createMasterData, deleteMasterData, listMasterData, updateMasterData } from "../services/master-data-service";
import type { MasterDataInput, MasterDataKind } from "../types";

const key = (kind: MasterDataKind) => ["master-data", kind] as const;
export function useMasterData(kind: MasterDataKind) { return useQuery({ queryKey: key(kind), queryFn: () => listMasterData(kind) }); }
export function useCreateMasterData(kind: MasterDataKind) { const client = useQueryClient(); return useMutation({ mutationFn: (input: MasterDataInput) => createMasterData(kind, input), onSuccess: () => client.invalidateQueries({ queryKey: key(kind) }) }); }
export function useUpdateMasterData(kind: MasterDataKind) { const client = useQueryClient(); return useMutation({ mutationFn: ({ id, input }: { id: string; input: MasterDataInput }) => updateMasterData(kind, id, input), onSuccess: () => client.invalidateQueries({ queryKey: key(kind) }) }); }
export function useDeleteMasterData(kind: MasterDataKind) { const client = useQueryClient(); return useMutation({ mutationFn: (id: string) => deleteMasterData(kind, id), onSuccess: () => client.invalidateQueries({ queryKey: key(kind) }) }); }
