import {
  IsArray,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class SuggestTasksDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(50, { message: 'List name cannot exceed 50 characters' })
  listName: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  existingTasks?: string[];

  @IsString()
  @IsOptional()
  @MaxLength(50, { message: 'Current input cannot exceed 50 characters' })
  currentInput?: string;

  @IsInt()
  @Min(1)
  @Max(10)
  @IsOptional()
  count?: number;
}
