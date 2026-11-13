import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsInt, IsNotEmpty, IsOptional, IsPositive, IsString, MaxLength } from "class-validator";

/** A line created from a source document line (PO from PR, GRR from PO, ...). */
export class SourceLineDto {
  @ApiProperty() @IsInt() sourceLineId!: number;
  @ApiProperty() @IsPositive() quantity!: number;
}

export class SubmitDto {
  @ApiProperty() @IsInt() approverId!: number;
}

export class ReasonDto {
  @ApiProperty() @IsString() @IsNotEmpty() reason!: string;
}

export class CodeNameDto {
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(50) code!: string;
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(300) name!: string;
}

/** Cancel: reason optional for DRAFT/REJECTED, required by the service for APPROVED documents. */
export class OptionalReasonDto {
  @ApiPropertyOptional() @IsOptional() @IsString() reason?: string;
}
