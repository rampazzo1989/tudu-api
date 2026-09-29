import { IsArray, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class ReorderListDto {
  @IsArray()
  @IsNotEmpty({ message: 'items array cannot be empty' })
  items: string[];

  @IsArray()
  @IsOptional()
  currentSections?: string[];

  @IsString()
  @IsOptional()
  @MaxLength(300, { message: 'Custom prompt cannot exceed 300 characters' })
  customPrompt?: string;

  @IsString()
  @IsOptional()
  @MaxLength(100, { message: 'List name cannot exceed 100 characters' })
  listName?: string;
}
