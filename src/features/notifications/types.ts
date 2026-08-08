export type NotificationSeverity="info"|"success"|"warning"|"error";
export type AppNotification={id:string;notificationType:string;title:string;message:string;severity:NotificationSeverity;entityType:string|null;entityId:string|null;actionUrl:string|null;readAt:string|null;createdAt:string};
