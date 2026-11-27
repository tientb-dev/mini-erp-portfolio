import { Module } from '@nestjs/common';
import { JobTitleAdminController, JobTitleAdminService } from './job-title-admin';
import { OrgUnitAdminController, OrgUnitAdminService } from './org-unit-admin';

/** Organization (ADR-0018): independent of Authorization and never grants permissions (BA-ORG-08). */
@Module({ controllers: [JobTitleAdminController, OrgUnitAdminController], providers: [JobTitleAdminService, OrgUnitAdminService] })
export class OrganizationModule {}
