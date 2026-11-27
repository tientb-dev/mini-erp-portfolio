import { Module } from '@nestjs/common';
import { JobTitleAdminController, JobTitleAdminService } from './job-title-admin';

/** Organization (ADR-0018): independent of Authorization and never grants permissions (BA-ORG-08). */
@Module({ controllers: [JobTitleAdminController], providers: [JobTitleAdminService] })
export class OrganizationModule {}
