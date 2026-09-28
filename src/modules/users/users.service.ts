import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async getMe(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        subscription: true,
        userSettings: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const now = new Date();
    const isPro =
      user.subscription &&
      ((user.subscription.status === 'TRIALING' && (!user.subscription.trialEndsAt || user.subscription.trialEndsAt > now)) ||
       (user.subscription.status === 'ACTIVE' && (!user.subscription.currentPeriodEndsAt || user.subscription.currentPeriodEndsAt > now)));

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      avatarUrl: user.avatarUrl,
      provider: user.provider,
      createdAt: user.createdAt,
      isPro: !!isPro,
      subscription: user.subscription,
      settings: user.userSettings,
    };
  }

  async deleteAccount(userId: string) {
    await this.prisma.user.delete({
      where: { id: userId },
    });
    return { success: true, message: 'Account and all cloud data permanently deleted.' };
  }
}
