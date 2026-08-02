export const masterDataKinds = ["venues", "bar_packages", "event_types", "payment_methods"] as const;
export type MasterDataKind = (typeof masterDataKinds)[number];
export type MasterDataRecord = { id: string; name: string; colorHex?: string; createdAt: string; updatedAt: string };
export type MasterDataInput = { name: string; colorHex?: string };

export const masterDataConfig: Record<MasterDataKind, { title: string; singular: string; description: string }> = {
  venues: { title: "אולמות", singular: "אולם", description: "ניהול האולמות הזמינים לאירועים." },
  bar_packages: { title: "חבילות בר", singular: "חבילת בר", description: "ניהול חבילות הבר המוצעות לאירועים." },
  event_types: { title: "סוגי אירועים", singular: "סוג אירוע", description: "ניהול סוגי האירועים שהצוות מספק." },
  payment_methods: { title: "אמצעי תשלום", singular: "אמצעי תשלום", description: "ניהול אמצעי התשלום המתקבלים." },
};
