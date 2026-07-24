-- Add completionPin to Booking
ALTER TABLE "Booking" ADD COLUMN "completionPin" TEXT;

-- Create ResetToken table
CREATE TABLE "ResetToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "used" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ResetToken_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ResetToken_token_key" ON "ResetToken"("token");
CREATE INDEX "ResetToken_token_idx" ON "ResetToken"("token");
CREATE INDEX "ResetToken_userId_idx" ON "ResetToken"("userId");
ALTER TABLE "ResetToken" ADD CONSTRAINT "ResetToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
