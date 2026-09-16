import type { PrismaClient } from "@prisma/client";
import { refreshUserStats } from "../matches/stats";

export type AuthProvider = "google" | "github";

export type ProviderProfile = {
  provider: AuthProvider;
  providerAccountId: string;
  email?: string | null;
  emailVerified: boolean;
  displayName: string;
  avatarUrl?: string | null;
};

export type MergeDecision = "existing-provider" | "merge-email" | "create";

export function canMergeByEmail(email: string | null | undefined, emailVerified: boolean): boolean {
  return Boolean(email && emailVerified);
}

export function decideAccountMerge(input: {
  providerUserId: string | null;
  emailOwnerUserId: string | null;
  email?: string | null;
  emailVerified: boolean;
}): MergeDecision {
  if (input.providerUserId) return "existing-provider";
  if (canMergeByEmail(input.email, input.emailVerified) && input.emailOwnerUserId) {
    return "merge-email";
  }
  return "create";
}

export async function findOrCreateUser(
  prisma: PrismaClient,
  profile: ProviderProfile,
  claimGuestId?: string,
) {
  const existingProvider = await prisma.accountProvider.findUnique({
    where: {
      provider_providerAccountId: {
        provider: profile.provider,
        providerAccountId: profile.providerAccountId,
      },
    },
  });

  const email = canMergeByEmail(profile.email, profile.emailVerified)
    ? profile.email!.toLowerCase()
    : null;

  const emailOwner = email
    ? await prisma.user.findUnique({ where: { email } })
    : null;

  const decision = decideAccountMerge({
    providerUserId: existingProvider?.userId ?? null,
    emailOwnerUserId: emailOwner?.id ?? null,
    email,
    emailVerified: profile.emailVerified,
  });

  const user = await prisma.$transaction(async (tx) => {
    if (decision === "existing-provider") {
      const linked = await tx.user.update({
        where: { id: existingProvider!.userId },
        data: {
          displayName: profile.displayName || undefined,
          avatarUrl: profile.avatarUrl ?? undefined,
          email: email ?? undefined,
        },
      });
      return linked;
    }

    if (decision === "merge-email") {
      await tx.accountProvider.create({
        data: {
          userId: emailOwner!.id,
          provider: profile.provider,
          providerAccountId: profile.providerAccountId,
        },
      });
      return tx.user.update({
        where: { id: emailOwner!.id },
        data: {
          displayName: profile.displayName || undefined,
          avatarUrl: profile.avatarUrl ?? undefined,
        },
      });
    }

    const created = await tx.user.create({
      data: {
        email,
        displayName: profile.displayName || "玩家",
        avatarUrl: profile.avatarUrl ?? null,
        accounts: {
          create: {
            provider: profile.provider,
            providerAccountId: profile.providerAccountId,
          },
        },
      },
    });
    return created;
  });

  if (claimGuestId) {
    const claimed = await prisma.matchParticipant.updateMany({
      where: { guestId: claimGuestId, userId: null },
      data: { userId: user.id },
    });
    if (claimed.count > 0) {
      await refreshUserStats(prisma, user.id);
    }
  }

  return user;
}

export function publicUser(user: {
  id: string;
  email: string | null;
  displayName: string;
  avatarUrl: string | null;
}) {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
  };
}
