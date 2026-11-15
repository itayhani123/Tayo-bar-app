export type ConfirmationRow = { label: string; before: string; after: string };
export type ProposalCard = { id: string; title: string; target: string; expiresAt: string; rows: ConfirmationRow[]; warnings: string[]; result?: ActionResult };
export type ActionResult = { status: "succeeded" | "cancelled" | "expired" | "stale" | "failed" | "forbidden"; eventId?: string; targetId?: string; href?: string; message?: string; replayed?: boolean };
export type ChatResult = { answer: string; proposals: ProposalCard[] };
