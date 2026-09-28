import { IsArray, IsNumber, IsObject, IsOptional, IsString } from 'class-validator';

export class SyncDeltaListDto {
  @IsString()
  id: string;

  @IsString()
  name: string;

  @IsString()
  @IsOptional()
  color?: string;

  @IsString()
  @IsOptional()
  icon?: string;

  @IsNumber()
  @IsOptional()
  order?: number;

  @IsOptional()
  isArchived?: boolean;

  @IsNumber()
  updatedAt: number;

  @IsNumber()
  @IsOptional()
  deletedAt?: number;
}

export class SyncDeltaTaskDto {
  @IsString()
  id: string;

  @IsString()
  @IsOptional()
  listId?: string;

  @IsString()
  title: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsOptional()
  done?: boolean;

  @IsOptional()
  starred?: boolean;

  @IsString()
  @IsOptional()
  dueDate?: string;

  @IsNumber()
  @IsOptional()
  order?: number;

  @IsOptional()
  isArchived?: boolean;

  @IsOptional()
  isUnlisted?: boolean;

  @IsNumber()
  updatedAt: number;

  @IsNumber()
  @IsOptional()
  deletedAt?: number;
}

export class SyncDeltaCounterDto {
  @IsString()
  id: string;

  @IsString()
  name: string;

  @IsNumber()
  count: number;

  @IsNumber()
  @IsOptional()
  step?: number;

  @IsString()
  @IsOptional()
  color?: string;

  @IsString()
  @IsOptional()
  icon?: string;

  @IsNumber()
  @IsOptional()
  order?: number;

  @IsNumber()
  updatedAt: number;

  @IsNumber()
  @IsOptional()
  deletedAt?: number;
}

export class SyncDeltaDto {
  @IsNumber()
  lastSyncTimestamp: number;

  @IsArray()
  @IsOptional()
  lists?: SyncDeltaListDto[];

  @IsArray()
  @IsOptional()
  tasks?: SyncDeltaTaskDto[];

  @IsArray()
  @IsOptional()
  counters?: SyncDeltaCounterDto[];

  @IsObject()
  @IsOptional()
  settings?: Record<string, any>;
}
