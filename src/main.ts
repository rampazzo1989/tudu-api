import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/http-exception.filter';

async function bootstrap() {
  const logger = new Logger('TuduApi');
  const app = await NestFactory.create(AppModule);

  // Security Headers via Helmet (relaxed CSP so Swagger UI /api/docs works)
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
    }),
  );

  // Global Exception Filter
  app.useGlobalFilters(new AllExceptionsFilter());

  // Strict Validation Pipe (Anti-Abuse / Mass-Assignment Defense)
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // CORS configuration: Safe for mobile emulators, native apps, and restrictive in production
  const isProd = process.env.NODE_ENV === 'production';
  const allowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map((o) => o.trim())
    : [];

  app.enableCors({
    origin: (origin, callback) => {
      // Mobile apps (React Native), emulators, curl, and Postman do NOT send an Origin header
      if (!origin) {
        return callback(null, true);
      }
      // In local development, always permit any origin for convenience
      if (!isProd) {
        return callback(null, true);
      }
      // In production, validate against whitelist
      if (
        allowedOrigins.length === 0 ||
        allowedOrigins.includes(origin) ||
        allowedOrigins.includes('*')
      ) {
        return callback(null, true);
      }
      return callback(new Error(`Blocked by CORS: origin ${origin} not allowed`));
    },
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    credentials: true,
  });

  // OpenAPI / Swagger Documentation
  const config = new DocumentBuilder()
    .setTitle('Tudú API')
    .setDescription(
      'Backend API for Tudú: AI services (DeepSeek & OpenAI), subscription management (RevenueCat), and offline-first cloud sync.',
    )
    .setVersion('1.0')
    .addBearerAuth()
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  const port = process.env.PORT || 3000;
  await app.listen(port, '0.0.0.0');
  logger.log(`🚀 Tudú API running on: http://0.0.0.0:${port}`);
  logger.log(`📚 Swagger documentation at: http://0.0.0.0:${port}/api/docs`);
}

bootstrap();
