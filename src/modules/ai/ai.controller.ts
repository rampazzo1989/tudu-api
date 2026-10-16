import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AiService } from './ai.service';
import { SuggestEmojisDto } from './dto/suggest-emojis.dto';
import { SuggestTasksDto } from './dto/suggest-tasks.dto';
import { ParseListDto } from './dto/parse-list.dto';
import { ReorderListDto } from './dto/reorder-list.dto';
import { ParseVoiceTuduDto } from './dto/parse-voice-tudu.dto';
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

  @Post('reorder-list')
  @HttpCode(HttpStatus.OK)
  async reorderList(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: ReorderListDto,
  ) {
    return this.aiService.reorderList(user.id, dto);
  }

  @Post('parse-voice-tudu')
  @HttpCode(HttpStatus.OK)
  async parseVoiceTudu(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: ParseVoiceTuduDto,
  ) {
    return this.aiService.parseVoiceTudu(user.id, dto);
  }

  @Post('parse-voice-audio')
  @UseInterceptors(FileInterceptor('audio'))
  @HttpCode(HttpStatus.OK)
  async parseVoiceAudio(
    @CurrentUser() user: CurrentUserData,
    @UploadedFile() file: any,
    @Body() body: any,
  ) {
    let audioBuffer: Buffer;
    let mimeType = 'audio/webm';

    if (file && file.buffer) {
      audioBuffer = file.buffer;
      mimeType = file.mimetype || 'audio/webm';
    } else if (body.audioBase64) {
      audioBuffer = Buffer.from(body.audioBase64, 'base64');
      if (body.mimeType) mimeType = body.mimeType;
    } else {
      throw new BadRequestException('Audio file or audioBase64 is required');
    }

    let lists = body.lists;
    if (typeof lists === 'string') {
      try {
        lists = JSON.parse(lists);
      } catch {
        lists = undefined;
      }
    }

    return this.aiService.parseVoiceAudio(user.id, {
      audioBuffer,
      mimeType,
      now: body.now || new Date().toISOString(),
      timezone: body.timezone,
      locale: body.locale,
      lists,
    });
  }

  @Get('quota')
  getQuota(@CurrentUser() user: CurrentUserData) {
    return this.aiService.getQuotaStatus(user.id);
  }
}
