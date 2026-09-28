import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() {
    try {
      await this.$connect();
    } catch (error) {
      console.warn('Prisma: Database connection not available on init. Queries will attempt on demand.', error?.message);
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
