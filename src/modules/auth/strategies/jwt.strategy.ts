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
    const isProd = configService.get<string>('NODE_ENV') === 'production';
    const secret = configService.get<string>('JWT_SECRET');

    if (isProd && (!secret || secret.includes('super_secret_jwt_key'))) {
      throw new Error(
        'CRITICAL SECURITY CONFIGURATION ERROR: JWT_SECRET must be set to a secure, unique string in production environment!',
      );
    }

    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: secret || 'tudu_super_secret_jwt_key_2026',
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
