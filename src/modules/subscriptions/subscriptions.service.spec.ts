import { SubscriptionsService } from './subscriptions.service';
import { PrismaService } from '../../prisma/prisma.service';
import { SubscriptionStatus } from '@prisma/client';

describe('SubscriptionsService', () => {
  let service: SubscriptionsService;
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      user: {
        findFirst: jest.fn(),
      },
      subscription: {
        upsert: jest.fn(),
        findUnique: jest.fn(),
      },
    };
    service = new SubscriptionsService(mockPrisma as PrismaService);
  });

  describe('handleRevenueCatEvent', () => {
    it('should set status to TRIALING when period_type is TRIAL', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({ id: 'user-1', email: 'test@tudu.app' });
      mockPrisma.subscription.upsert.mockResolvedValue({});

      const event = {
        type: 'INITIAL_PURCHASE',
        period_type: 'TRIAL',
        app_user_id: 'user-1',
        purchased_at_ms: Date.now(),
        expiration_at_ms: Date.now() + 7 * 24 * 60 * 60 * 1000,
        currency: 'BRL',
      };

      const result = await service.handleRevenueCatEvent(event);
      expect(result.updated).toBe(true);
      expect(result.status).toBe(SubscriptionStatus.TRIALING);
      expect(mockPrisma.subscription.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'user-1' },
          create: expect.objectContaining({ status: SubscriptionStatus.TRIALING, priceCents: 490 }),
        }),
      );
    });

    it('should set status to ACTIVE on RENEWAL event', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({ id: 'user-1', email: 'test@tudu.app' });
      mockPrisma.subscription.upsert.mockResolvedValue({});

      const event = {
        type: 'RENEWAL',
        period_type: 'NORMAL',
        app_user_id: 'user-1',
        purchased_at_ms: Date.now(),
        expiration_at_ms: Date.now() + 30 * 24 * 60 * 60 * 1000,
      };

      const result = await service.handleRevenueCatEvent(event);
      expect(result.status).toBe(SubscriptionStatus.ACTIVE);
    });

    it('should set status to EXPIRED on EXPIRATION event', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({ id: 'user-1', email: 'test@tudu.app' });
      mockPrisma.subscription.upsert.mockResolvedValue({});

      const event = {
        type: 'EXPIRATION',
        app_user_id: 'user-1',
      };

      const result = await service.handleRevenueCatEvent(event);
      expect(result.status).toBe(SubscriptionStatus.EXPIRED);
    });

    it('should return received: true, updated: false if user is not found', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null);

      const event = {
        type: 'INITIAL_PURCHASE',
        app_user_id: 'unknown-user',
      };

      const result = await service.handleRevenueCatEvent(event);
      expect(result.received).toBe(true);
      expect(result.updated).toBe(false);
      expect(mockPrisma.subscription.upsert).not.toHaveBeenCalled();
    });
  });

  describe('getSubscriptionStatus', () => {
    it('should return isPro: true when status is TRIALING and trial is valid', async () => {
      const future = new Date(Date.now() + 4 * 24 * 60 * 60 * 1000);
      mockPrisma.subscription.findUnique.mockResolvedValue({
        userId: 'user-1',
        status: SubscriptionStatus.TRIALING,
        trialEndsAt: future,
        planId: 'tudu_pro_monthly',
      });

      const status = await service.getSubscriptionStatus('user-1');
      expect(status.isPro).toBe(true);
      expect(status.status).toBe('TRIALING');
      expect(status.price).toBe('R$ 4,90/mês');
    });

    it('should return isPro: false when no subscription exists', async () => {
      mockPrisma.subscription.findUnique.mockResolvedValue(null);

      const status = await service.getSubscriptionStatus('user-1');
      expect(status.isPro).toBe(false);
      expect(status.status).toBe('INACTIVE');
    });
  });

  describe('devActivate', () => {
    it('should activate a 7-day trial in development', async () => {
      mockPrisma.subscription.upsert.mockImplementation((args: any) => Promise.resolve(args.create));

      const result = await service.devActivate('user-dev-1', true);
      expect(result.success).toBe(true);
      expect(result.subscription.status).toBe(SubscriptionStatus.TRIALING);
    });
  });
});
