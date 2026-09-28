import { IsEmail, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class DevLoginDto {
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  devSecret?: string;
}
