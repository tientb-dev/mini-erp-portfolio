import { Module } from '@nestjs/common';
import { DossierModule } from '../document-dossier/dossier.module';
import { ProcurementController } from './procurement.controller';
import { ProcurementService } from './procurement.service';

@Module({ imports: [DossierModule], controllers: [ProcurementController], providers: [ProcurementService], exports: [ProcurementService] })
export class ProcurementModule {}
