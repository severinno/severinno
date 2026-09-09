-- CreateIndex
CREATE INDEX "Notification_userId_read_createdAt_idx" ON "Notification"("userId", "read", "createdAt");

-- CreateIndex
CREATE INDEX "ScheduledPushNotification_status_scheduledAt_idx" ON "ScheduledPushNotification"("status", "scheduledAt");