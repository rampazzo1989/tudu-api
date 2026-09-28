import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../prisma/prisma.service';

export interface JwtPayload {
  sub: string;
  email: string;
  iat?: number;
  exp?: number;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('JWT_SECRET', 'tudu_super_secret_jwt_key_2026'),
    });
  }

  async validate(payload: JwtPayload) {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      include: { subscription: true },
    });

    if (!user) {
      throw new UnauthorizedException('User no longer exists');
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
      isPro: !!isPro,
      subscription: user.subscription,
    };
  }
}
