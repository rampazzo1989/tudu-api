import { IsIn, IsNotEmpty, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class SuggestEmojisDto {
  @IsIn(['tudu', 'list'])
  type: 'tudu' | 'list';

  @IsString()
  @IsNotEmpty()
  @MinLength(2, { message: 'Title must be at least 2 characters long' })
  @MaxLength(100, { message: 'Title cannot exceed 100 characters' })
  title: string;

  @IsString()
  @IsOptional()
  @MaxLength(50, { message: 'List name cannot exceed 50 characters' })
  listName?: string;
}
