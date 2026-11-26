import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayUnique, IsArray, IsBoolean, IsDateString, IsInt, IsObject, IsOptional, IsPositive, IsString, IsUUID, Matches, Max, MaxLength, Min, ValidateNested } from 'class-validator';

export const MAX_DOSSIER_ID = 2_147_483_647;

export class DossierRowUpdate {
  @ApiProperty() @IsInt() @IsPositive() @Max(MAX_DOSSIER_ID) dossierTypeId!: number;
  @ApiProperty({ minimum: 0, description: 'Use 0 while creating, otherwise the current dossier row version.' }) @IsInt() @Min(0) version!: number;
  @ApiProperty() @IsBoolean() hasPaper!: boolean;
  @ApiPropertyOptional({ type: String, nullable: true, format: 'date' })
  @IsOptional() @Matches(/^(?!0000)\d{4}-\d{2}-\d{2}$/) @IsDateString({ strict: true }) issuedOn?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) @IsOptional() @IsString() @MaxLength(300) issuer?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) @IsOptional() @IsString() @MaxLength(4000) note?: string | null;
  @ApiPropertyOptional({ type: Number, nullable: true }) @IsOptional() @IsInt() @IsPositive() @Max(MAX_DOSSIER_ID) fileId?: number | null;
}

export class DossierUpdate {
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID('4') sessionKey?: string;
  @ApiProperty({ type: [DossierRowUpdate] }) @IsArray() @IsObject({ each: true }) @ArrayUnique((row: DossierRowUpdate) => row?.dossierTypeId)
  @ValidateNested({ each: true }) @Type(() => DossierRowUpdate) rows!: DossierRowUpdate[];
}

export class NewDossierUpdate extends DossierUpdate {
  @ApiProperty() @Matches(/^[0-9a-f]{64}$/) revision!: string;
}
