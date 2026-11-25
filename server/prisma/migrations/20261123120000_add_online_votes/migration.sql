ALTER TABLE "MatchParticipant" ADD COLUMN "replacedByAiAt" TIMESTAMP(3);

CREATE TABLE "MatchVote" (
    "id" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "initiatedBySeat" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deadlineAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "result" TEXT,

    CONSTRAINT "MatchVote_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MatchVoteBallot" (
    "voteId" TEXT NOT NULL,
    "seatIndex" INTEGER NOT NULL,
    "choice" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MatchVoteBallot_pkey" PRIMARY KEY ("voteId","seatIndex")
);

CREATE INDEX "MatchVote_matchId_resolvedAt_idx" ON "MatchVote"("matchId", "resolvedAt");
CREATE INDEX "MatchVote_deadlineAt_idx" ON "MatchVote"("deadlineAt");

ALTER TABLE "MatchVote" ADD CONSTRAINT "MatchVote_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MatchVoteBallot" ADD CONSTRAINT "MatchVoteBallot_voteId_fkey" FOREIGN KEY ("voteId") REFERENCES "MatchVote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Online saves are no longer supported. Keep the save rows for history, but a
-- playing online match that was waiting on a save cannot continue under the new
-- rules, so close it as abandoned.
UPDATE "Match"
SET "status" = 'abandoned',
    "endedAt" = COALESCE("endedAt", CURRENT_TIMESTAMP),
    "verified" = false
WHERE "mode" = 'online'
  AND "status" = 'playing'
  AND EXISTS (SELECT 1 FROM "MatchSave" WHERE "MatchSave"."matchId" = "Match"."id");
