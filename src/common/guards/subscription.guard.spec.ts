import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { SubscriptionGuard } from './subscription.guard';
import { PrismaService } from '../../prisma/prisma.service';

describe('SubscriptionGuard', () => {
  let guard: SubscriptionGuard;
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      subscription: {
        findUnique: jest.fn(),
      },
    };
    guard = new SubscriptionGuard(mockPrisma as PrismaService);
  });

  const createMockContext = (user?: any) => {
    const request: any = { user };
    return {
      switchToHttp: () => ({
        getRequest: () => request,
      }),
    } as ExecutionContext;
  };

  it('should throw UnauthorizedException if user is not in request', async () => {
    const context = createMockContext(null);
    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
  });

  it('should throw ForbiddenException if user has no subscription record', async () => {
    const context = createMockContext({ id: 'user-1' });
    mockPrisma.subscription.findUnique.mockResolvedValue(null);

    await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
  });

  it('should allow access if user is in valid 7-day trial (TRIALING)', async () => {
    const context = createMockContext({ id: 'user-1' });
    const future = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000); // 5 days left
    mockPrisma.subscription.findUnique.mockResolvedValue({
      userId: 'user-1',
      status: 'TRIALING',
      trialEndsAt: future,
    });

    const result = await guard.canActivate(context);
    expect(result).toBe(true);
  });

  it('should throw ForbiddenException if trial has expired', async () => {
    const context = createMockContext({ id: 'user-1' });
    const past = new Date(Date.now() - 1000);
    mockPrisma.subscription.findUnique.mockResolvedValue({
      userId: 'user-1',
      status: 'TRIALING',
      trialEndsAt: past,
    });

    await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
  });

  it('should allow access if user has active paid subscription (ACTIVE)', async () => {
    const context = createMockContext({ id: 'user-1' });
    const future = new Date(Date.now() + 20 * 24 * 60 * 60 * 1000);
    mockPrisma.subscription.findUnique.mockResolvedValue({
      userId: 'user-1',
      status: 'ACTIVE',
      currentPeriodEndsAt: future,
    });

    const result = await guard.canActivate(context);
    expect(result).toBe(true);
  });

  it('should throw ForbiddenException if subscription status is EXPIRED', async () => {
    const context = createMockContext({ id: 'user-1' });
    mockPrisma.subscription.findUnique.mockResolvedValue({
      userId: 'user-1',
      status: 'EXPIRED',
    });

    await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
  });
});
