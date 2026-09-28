import { IsArray, IsObject, IsOptional } from 'class-validator';

export class SyncSnapshotDto {
  @IsObject()
  @IsOptional()
  metadata?: Record<string, any>;

  @IsObject()
  data: {
    myLists?: [string, any][];
    archivedLists?: [string, any][];
    tudus?: [string, [string, any][]][];
    archivedTudus?: [string, [string, any][]][];
    unlistedTudus?: [string, any][];
    counters?: [string, any][];
    emojiUsage?: [string, number][];
    settings?: Record<string, any>;
  };
}
