import { Module } from '@nestjs/common';
import { AlexaController } from './alexa.controller';
import { AlexaService } from './alexa.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [AlexaController],
  providers: [AlexaService],
  exports: [AlexaService],
})
export class AlexaModule {}
