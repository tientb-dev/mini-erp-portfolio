import { Module } from '@nestjs/common';
import { GiService } from './gi.service';
import { GirService } from './gir.service';
import { OutboundController } from './outbound.controller';

@Module({ controllers: [OutboundController], providers: [GirService, GiService], exports: [GirService, GiService] })
export class OutboundModule {}
