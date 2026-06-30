-- Add password hash column for custom JWT auth (nullable for existing rows).
ALTER TABLE "User" ADD COLUMN "passwordHash" TEXT;
