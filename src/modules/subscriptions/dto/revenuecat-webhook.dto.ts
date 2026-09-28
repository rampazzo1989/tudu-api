import { IsNotEmpty, IsObject, IsOptional, IsString } from 'class-validator';

export class RevenueCatEventDto {
  @IsString()
  @IsNotEmpty()
  type: string; // INITIAL_PURCHASE, RENEWAL, CANCELLATION, EXPIRATION, etc.

  @IsString()
  @IsNotEmpty()
  app_user_id: string; // Matches our User.id or User.email

  @IsString()
  @IsOptional()
  product_id?: string;

  @IsString()
  @IsOptional()
  period_type?: string; // TRIAL, NORMAL, INTRO

  @IsOptional()
  purchased_at_ms?: number;

  @IsOptional()
  expiration_at_ms?: number;

  @IsString()
  @IsOptional()
  currency?: string;

  @IsOptional()
  price_in_purchased_currency?: number;
}

export class RevenueCatWebhookDto {
  @IsString()
  @IsNotEmpty()
  api_version: string;

  @IsObject()
  @IsNotEmpty()
  event: RevenueCatEventDto;
}
