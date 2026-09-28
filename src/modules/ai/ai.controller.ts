import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AiService } from './ai.service';
import { SuggestEmojisDto } from './dto/suggest-emojis.dto';
import { SuggestTasksDto } from './dto/suggest-tasks.dto';
import { ParseListDto } from './dto/parse-list.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SubscriptionGuard } from '../../common/guards/subscription.guard';
import { CurrentUser, CurrentUserData } from '../../common/decorators/current-user.decorator';

@Controller('api/v1/ai')
@UseGuards(JwtAuthGuard, SubscriptionGuard)
export class AiController {
  constructor(private readonly aiService: AiService) {}

  @Post('suggest-emojis')
  @HttpCode(HttpStatus.OK)
  async suggestEmojis(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: SuggestEmojisDto,
  ) {
    const response = await this.aiService.suggestEmojis(user.id, dto);
    return {
      emojis: response.emojis,
      providerUsed: response.providerUsed,
    };
  }

  @Post('suggest-tasks')
  @HttpCode(HttpStatus.OK)
  async suggestTasks(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: SuggestTasksDto,
  ) {
    return this.aiService.suggestTasks(user.id, dto);
  }

  @Post('parse-list')
  @HttpCode(HttpStatus.OK)
  async parseList(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: ParseListDto,
  ) {
    return this.aiService.parseList(user.id, dto);
  }

  @Get('quota')
  getQuota(@CurrentUser() user: CurrentUserData) {
    return this.aiService.getQuotaStatus(user.id);
  }
}
