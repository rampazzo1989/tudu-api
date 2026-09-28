import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class SubscriptionGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user || !user.id) {
      throw new UnauthorizedException('Authentication required');
    }

    const subscription = await this.prisma.subscription.findUnique({
      where: { userId: user.id },
    });

    if (!subscription) {
      throw new ForbiddenException({
        code: 'SUBSCRIPTION_REQUIRED',
        message: 'Assinatura Tudú Pro necessária (R$ 4,90/mês com 1ª semana grátis).',
        isPro: false,
      });
    }

    const now = new Date();
    const isTrialValid =
      subscription.status === 'TRIALING' &&
      (!subscription.trialEndsAt || subscription.trialEndsAt > now);

    const isActiveValid =
      subscription.status === 'ACTIVE' &&
      (!subscription.currentPeriodEndsAt || subscription.currentPeriodEndsAt > now);

    if (!isTrialValid && !isActiveValid) {
      throw new ForbiddenException({
        code: 'SUBSCRIPTION_EXPIRED',
        message: 'Sua assinatura Tudú Pro expirou. Renove para continuar usando.',
        status: subscription.status,
        isPro: false,
      });
    }

    // Attach verified subscription info to request
    request.subscription = subscription;
    return true;
  }
}
