import {
  Controller,
  Post,
  Get,
  Body,
  Headers,
  UnauthorizedException,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SubscriptionsService } from './subscriptions.service';
import { RevenueCatWebhookDto } from './dto/revenuecat-webhook.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser, CurrentUserData } from '../../common/decorators/current-user.decorator';

@Controller('api/v1')
export class SubscriptionsController {
  constructor(
    private readonly subscriptionsService: SubscriptionsService,
    private readonly configService: ConfigService,
  ) {}

  @Post('webhooks/revenuecat')
  @HttpCode(HttpStatus.OK)
  async handleWebhook(
    @Body() dto: RevenueCatWebhookDto,
    @Headers('authorization') authHeader?: string,
  ) {
    const expectedSecret = this.configService.get<string>('REVENUECAT_WEBHOOK_AUTH_TOKEN');
    if (expectedSecret && authHeader !== `Bearer ${expectedSecret}`) {
      throw new UnauthorizedException('Invalid RevenueCat webhook secret token');
    }

    if (!dto?.event) {
      return { received: false, reason: 'No event payload' };
    }

    return this.subscriptionsService.handleRevenueCatEvent(dto.event);
  }

  @Get('subscriptions/status')
  @UseGuards(JwtAuthGuard)
  async getStatus(@CurrentUser() user: CurrentUserData) {
    return this.subscriptionsService.getSubscriptionStatus(user.id);
  }

  @Post('subscriptions/dev-activate')
  @UseGuards(JwtAuthGuard)
  async devActivate(
    @CurrentUser() user: CurrentUserData,
    @Body('isTrial') isTrial?: boolean,
  ) {
    return this.subscriptionsService.devActivate(user.id, isTrial ?? true);
  }
}
