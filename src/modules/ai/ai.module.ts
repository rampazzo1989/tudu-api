import { Module } from '@nestjs/common';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { DeepSeekProvider } from './providers/deepseek.provider';
import { OpenAiProvider } from './providers/openai.provider';
import { SubscriptionGuard } from '../../common/guards/subscription.guard';

@Module({
  controllers: [AiController],
  providers: [AiService, DeepSeekProvider, OpenAiProvider, SubscriptionGuard],
  exports: [AiService],
})
export class AiModule {}
