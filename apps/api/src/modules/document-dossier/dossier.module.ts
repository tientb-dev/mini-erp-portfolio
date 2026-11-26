import { Body, Controller, Get, HttpCode, Module, Param, ParseEnumPipe, ParseIntPipe, Patch, Post, Put, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ArrayUnique, IsArray, IsBoolean, IsInt, IsOptional, IsString, Matches, MaxLength, Min } from 'class-validator';
import { DOCUMENT_TARGETS, DocumentTarget } from '../document-records/document-records';
import { AuthedRequest, RequirePermissions } from '../identity/auth';
import { DossierService } from './dossier.service';
import { DossierStorage } from './dossier-storage';
import { DossierDocuments } from './dossier-documents';

class DossierTypeInput {
  @IsString() @Matches(/\S/) @MaxLength(50) code!: string;
  @IsString() @Matches(/\S/) @MaxLength(300) name!: string;
  @IsOptional() @IsString() description?: string | null;
}
class StatusInput { @IsBoolean() isActive!: boolean }
class ConfigurationInput {
  @IsInt() @Min(0) version!: number;
  @IsArray() @ArrayUnique() @IsInt({ each: true }) @Min(1, { each: true }) dossierTypeIds!: number[];
}

const documentType = new ParseEnumPipe(Object.fromEntries(DOCUMENT_TARGETS.map(value => [value, value])));

@ApiTags('document dossier')
@ApiBearerAuth()
@Controller()
class DossierController {
  constructor(private readonly dossiers: DossierService) {}

  @Get('dossier-types') @RequirePermissions('DOSSIER_TYPE.VIEW')
  types() { return this.dossiers.listTypes(); }

  @Get('dossier-types/:id') @RequirePermissions('DOSSIER_TYPE.VIEW')
  type(@Param('id', ParseIntPipe) id: number) { return this.dossiers.getType(id); }

  @Post('dossier-types') @RequirePermissions('DOSSIER_TYPE.MANAGE')
  create(@Body() body: DossierTypeInput, @Req() req: AuthedRequest) { return this.dossiers.saveType(body, req.user.id); }

  @Patch('dossier-types/:id') @RequirePermissions('DOSSIER_TYPE.MANAGE')
  update(@Param('id', ParseIntPipe) id: number, @Body() body: DossierTypeInput, @Req() req: AuthedRequest) {
    return this.dossiers.saveType(body, req.user.id, id);
  }

  @Patch('dossier-types/:id/status') @HttpCode(204) @RequirePermissions('DOSSIER_TYPE.MANAGE')
  status(@Param('id', ParseIntPipe) id: number, @Body() body: StatusInput, @Req() req: AuthedRequest) {
    return this.dossiers.status(id, body.isActive, req.user.id);
  }

  @Get('dossier-configurations') @RequirePermissions('DOSSIER_CONFIG.MANAGE')
  configurations() { return this.dossiers.configurations(); }

  @Get('dossier-configurations/catalog') @RequirePermissions('DOSSIER_CONFIG.MANAGE')
  catalog() { return this.dossiers.listTypes(); }

  @Get('dossier-configurations/:type') @RequirePermissions('DOSSIER_CONFIG.MANAGE')
  configuration(@Param('type', documentType) type: DocumentTarget) { return this.dossiers.configuration(type); }

  @Put('dossier-configurations/:type') @HttpCode(204) @RequirePermissions('DOSSIER_CONFIG.MANAGE')
  save(@Param('type', documentType) type: DocumentTarget, @Body() body: ConfigurationInput, @Req() req: AuthedRequest) {
    return this.dossiers.saveConfiguration(type, body.version, body.dossierTypeIds, req.user.id);
  }
}

@Module({ controllers: [DossierController], providers: [DossierService, DossierStorage, DossierDocuments],
  exports: [DossierDocuments] })
export class DossierModule {}
