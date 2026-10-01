-- AlterTable
ALTER TABLE "Match" ADD COLUMN "hostSeatIndex" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "joinCode" TEXT;

-- CreateTable
CREATE TABLE "SaveConsent" (
    "id" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "seatIndex" INTEGER NOT NULL,
    "userId" TEXT,
    "guestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SaveConsent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Match_joinCode_key" ON "Match"("joinCode");

-- CreateIndex
CREATE UNIQUE INDEX "SaveConsent_matchId_seatIndex_key" ON "SaveConsent"("matchId", "seatIndex");

-- AddForeignKey
ALTER TABLE "SaveConsent" ADD CONSTRAINT "SaveConsent_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE;
