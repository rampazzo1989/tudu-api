import { IsIn, IsNotEmpty, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class ParseListDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(5, { message: 'Raw text must be at least 5 characters long' })
  @MaxLength(6000, { message: 'Raw text cannot exceed 6000 characters to prevent abuse' })
  rawText: string;

  @IsIn(['none', 'smart', 'custom'])
  @IsOptional()
  orderingType?: 'none' | 'smart' | 'custom';

  @IsString()
  @IsOptional()
  @MaxLength(400, { message: 'Custom prompt cannot exceed 400 characters' })
  customPrompt?: string;
}
