import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/http-exception.filter';

async function bootstrap() {
  const logger = new Logger('TuduApi');
  const app = await NestFactory.create(AppModule);

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

  // Enable CORS for mobile and web clients
  app.enableCors({
    origin: '*',
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
  await app.listen(port);
  logger.log(`🚀 Tudú API running on: http://localhost:${port}`);
  logger.log(`📚 Swagger documentation at: http://localhost:${port}/api/docs`);
}

bootstrap();
