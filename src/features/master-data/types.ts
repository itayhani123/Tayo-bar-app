export const masterDataKinds = ["venues", "bar_packages", "event_types", "payment_methods"] as const;
export type MasterDataKind = (typeof masterDataKinds)[number];
export type MasterDataRecord = { id: string; name: string; createdAt: string; updatedAt: string };
export type MasterDataInput = { name: string };

export const masterDataConfig: Record<MasterDataKind, { title: string; singular: string; description: string }> = {
  venues: { title: "Venues", singular: "Venue", description: "Manage locations available for events." },
  bar_packages: { title: "Bar Packages", singular: "Bar Package", description: "Manage the packages offered for events." },
  event_types: { title: "Event Types", singular: "Event Type", description: "Manage the types of events your team supports." },
  payment_methods: { title: "Payment Methods", singular: "Payment Method", description: "Manage accepted payment methods." },
};
