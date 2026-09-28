import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class AppleLoginDto {
  @IsString()
  @IsNotEmpty()
  identityToken: string;

  @IsString()
  @IsOptional()
  fullName?: string;

  @IsString()
  @IsOptional()
  email?: string;
}
