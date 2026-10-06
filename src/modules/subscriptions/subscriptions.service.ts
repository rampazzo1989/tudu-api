import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RevenueCatEventDto } from './dto/revenuecat-webhook.dto';
import { SubscriptionStatus } from '@prisma/client';

@Injectable()
export class SubscriptionsService {
  private readonly logger = new Logger(SubscriptionsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async handleRevenueCatEvent(event: RevenueCatEventDto) {
    this.logger.log(`Processing RevenueCat event: ${event.type} for app_user_id: ${event.app_user_id}`);

    // Try finding user by id or email
    const user = await this.prisma.user.findFirst({
      where: {
        OR: [{ id: event.app_user_id }, { email: event.app_user_id }],
      },
    });

    if (!user) {
      this.logger.warn(`User not found for RevenueCat app_user_id: ${event.app_user_id}`);
      return { received: true, updated: false, reason: 'User not found' };
    }

    const purchasedAt = event.purchased_at_ms ? new Date(event.purchased_at_ms) : new Date();
    const expiresAt = event.expiration_at_ms ? new Date(event.expiration_at_ms) : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    let newStatus: SubscriptionStatus = SubscriptionStatus.ACTIVE;

    if (event.type === 'INITIAL_PURCHASE' && event.period_type === 'TRIAL') {
      newStatus = SubscriptionStatus.TRIALING;
    } else if (event.type === 'INITIAL_PURCHASE' || event.type === 'RENEWAL' || event.type === 'UNCANCELLATION') {
      newStatus = SubscriptionStatus.ACTIVE;
    } else if (event.type === 'CANCELLATION') {
      // Cancellation means auto-renew turned off, but active until period ends
      newStatus = expiresAt > new Date() ? SubscriptionStatus.CANCELED : SubscriptionStatus.EXPIRED;
    } else if (event.type === 'EXPIRATION') {
      newStatus = SubscriptionStatus.EXPIRED;
    } else if (event.type === 'BILLING_ISSUE') {
      newStatus = SubscriptionStatus.PAST_DUE;
    }

    await this.prisma.subscription.upsert({
      where: { userId: user.id },
      update: {
        status: newStatus,
        planId: event.product_id || 'tudu_pro_monthly',
        trialStartsAt: newStatus === SubscriptionStatus.TRIALING ? purchasedAt : undefined,
        trialEndsAt: newStatus === SubscriptionStatus.TRIALING ? expiresAt : undefined,
        currentPeriodStartsAt: purchasedAt,
        currentPeriodEndsAt: expiresAt,
        revenueCatAppUserId: event.app_user_id,
      },
      create: {
        userId: user.id,
        status: newStatus,
        planId: event.product_id || 'tudu_pro_monthly',
        priceCents: 490, // R$ 4,90
        currency: event.currency || 'BRL',
        trialStartsAt: newStatus === SubscriptionStatus.TRIALING ? purchasedAt : null,
        trialEndsAt: newStatus === SubscriptionStatus.TRIALING ? expiresAt : null,
        currentPeriodStartsAt: purchasedAt,
        currentPeriodEndsAt: expiresAt,
        originalPurchaseDate: purchasedAt,
        revenueCatAppUserId: event.app_user_id,
      },
    });

    this.logger.log(`Subscription for user ${user.id} updated to ${newStatus}`);
    return { received: true, updated: true, status: newStatus };
  }

  async getSubscriptionStatus(userId: string) {
    const subscription = await this.prisma.subscription.findUnique({
      where: { userId },
    });

    const now = new Date();
    const isPro =
      subscription &&
      ((subscription.status === 'TRIALING' && (!subscription.trialEndsAt || subscription.trialEndsAt > now)) ||
       (subscription.status === 'ACTIVE' && (!subscription.currentPeriodEndsAt || subscription.currentPeriodEndsAt > now)));

    return {
      isPro: !!isPro,
      status: subscription?.status || 'INACTIVE',
      planId: subscription?.planId || null,
      price: 'R$ 4,90/mês',
      trialEndsAt: subscription?.trialEndsAt || null,
      currentPeriodEndsAt: subscription?.currentPeriodEndsAt || null,
    };
  }

  async devActivate(userId: string, isTrial: boolean = true) {
    const now = new Date();
    const trialEndsAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000); // 7 days trial
    const periodEndsAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    const subscription = await this.prisma.subscription.upsert({
      where: { userId },
      update: {
        status: isTrial ? SubscriptionStatus.TRIALING : SubscriptionStatus.ACTIVE,
        trialStartsAt: isTrial ? now : null,
        trialEndsAt: isTrial ? trialEndsAt : null,
        currentPeriodStartsAt: now,
        currentPeriodEndsAt: isTrial ? trialEndsAt : periodEndsAt,
      },
      create: {
        userId,
        status: isTrial ? SubscriptionStatus.TRIALING : SubscriptionStatus.ACTIVE,
        planId: 'tudu_pro_monthly',
        priceCents: 490,
        currency: 'BRL',
        trialStartsAt: isTrial ? now : null,
        trialEndsAt: isTrial ? trialEndsAt : null,
        currentPeriodStartsAt: now,
        currentPeriodEndsAt: isTrial ? trialEndsAt : periodEndsAt,
        originalPurchaseDate: now,
      },
    });

    return { success: true, subscription };
  }

  async syncClientSubscription(
    userId: string,
    dto: { isPro: boolean; status?: string; planId?: string },
  ) {
    if (!dto.isPro) {
      return this.getSubscriptionStatus(userId);
    }

    const now = new Date();
    const periodEndsAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    const newStatus =
      dto.status === 'TRIALING'
        ? SubscriptionStatus.TRIALING
        : SubscriptionStatus.ACTIVE;

    const subscription = await this.prisma.subscription.upsert({
      where: { userId },
      update: {
        status: newStatus,
        planId: dto.planId || 'tudu_pro_monthly',
        currentPeriodEndsAt: periodEndsAt,
      },
      create: {
        userId,
        status: newStatus,
        planId: dto.planId || 'tudu_pro_monthly',
        priceCents: 490,
        currency: 'BRL',
        trialStartsAt: newStatus === SubscriptionStatus.TRIALING ? now : null,
        trialEndsAt: newStatus === SubscriptionStatus.TRIALING ? periodEndsAt : null,
        currentPeriodStartsAt: now,
        currentPeriodEndsAt: periodEndsAt,
        originalPurchaseDate: now,
      },
    });

    this.logger.log(`[SubscriptionSync] Client synced Pro subscription for user ${userId} (${newStatus})`);

    return {
      isPro: true,
      status: subscription.status,
      planId: subscription.planId,
      price: 'R$ 4,90/mês',
      trialEndsAt: subscription.trialEndsAt,
      currentPeriodEndsAt: subscription.currentPeriodEndsAt,
    };
  }
}
