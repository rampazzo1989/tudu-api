import { Type } from 'class-transformer';
import {
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class VoiceListContextDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  id: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;
}

export class ParseVoiceTuduDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(2, { message: 'Transcript must be at least 2 characters long' })
  @MaxLength(500, { message: 'Transcript cannot exceed 500 characters' })
  transcript: string;

  @IsString()
  @IsOptional()
  @MaxLength(20)
  locale?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  now: string;

  @IsString()
  @IsOptional()
  @MaxLength(50)
  timezone?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => VoiceListContextDto)
  @IsOptional()
  lists?: VoiceListContextDto[];
}
