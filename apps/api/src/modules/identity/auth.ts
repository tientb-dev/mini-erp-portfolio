import {
  Body, CanActivate, Controller, ExecutionContext, Get, HttpCode, HttpStatus, Injectable, Param, ParseIntPipe, Patch, Post, Req,
  SetMetadata, UnauthorizedException, ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ApiBearerAuth, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { Request } from 'express';
import { DataSource } from 'typeorm';
import { BusinessError } from '../workflow/workflow';
import { AccountSecurityService, PASSWORD_MAX_LENGTH } from './account-security';
import { loadGrants } from './authorization';

/** Resolved on every request; permissions and warehouse scope come from the DB, not the token. */
export interface CurrentUser {
  id: number;
  username: string;
  fullName: string;
  permissions: string[];
  roleCodes?: string[];
  warehouseIds: number[];
  mustChangePassword?: boolean;
  /** Session of the current HTTP request; absent for service-level callers (seed, tests). */
  sessionId?: string;
}

export type AuthedRequest = Request & { user: CurrentUser };

const PERMISSIONS_KEY = 'permissions';
const PUBLIC_KEY = 'public';
const PASSWORD_CHANGE_KEY = 'passwordChangeAllowed';
/** All listed FUNCTION.ACTION permissions are required. */
export const RequirePermissions = (...codes: string[]) => SetMetadata(PERMISSIONS_KEY, codes);
export const Public = () => SetMetadata(PUBLIC_KEY, true);
/** Reachable while `must_change_password` is set (BA-USR-06): only me, change-password and logout. */
const AllowedBeforePasswordChange = () => SetMetadata(PASSWORD_CHANGE_KEY, true);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class IdentityService {
  constructor(private readonly ds: DataSource) {}

  /** Service-level load (no session); HTTP requests go through AuthGuard, which also requires an open session. */
  async loadCurrentUser(id: number, sessionId?: string): Promise<CurrentUser | null> {
    const user = await loadGrants(this.ds.manager, id, sessionId);
    return user ? { ...user, ...(sessionId ? { sessionId } : {}) } : null;
  }
}

/** Global guard: authentication (Bearer JWT + open session) + RBAC FUNCTION.ACTION (ADR-0006, ADR-0018). */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly jwt: JwtService, private readonly identity: IdentityService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, targets)) return true;

    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const token = req.headers.authorization?.replace(/^Bearer /, '');
    if (!token) throw new UnauthorizedException();
    let claims: { sub?: unknown; sid?: unknown };
    try {
      claims = await this.jwt.verifyAsync(token);
    } catch {
      throw new UnauthorizedException();
    }
    // Legacy tokens without a session id are rejected (OA1.2).
    if (typeof claims.sub !== 'number' || typeof claims.sid !== 'string' || !UUID.test(claims.sid)) throw new UnauthorizedException();
    const user = await this.identity.loadCurrentUser(claims.sub, claims.sid);
    if (!user) throw new UnauthorizedException();
    req.user = user;

    if (user.mustChangePassword && !this.reflector.getAllAndOverride<boolean>(PASSWORD_CHANGE_KEY, targets)) {
      throw new BusinessError('PASSWORD_CHANGE_REQUIRED', 'Change your password to continue', HttpStatus.FORBIDDEN);
    }
    const required = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, targets) ?? [];
    const missing = required.filter((p) => !user.permissions.includes(p));
    if (missing.length) throw new ForbiddenException(`Missing permission: ${missing.join(', ')}`);
    return true;
  }
}

class LoginDto {
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(100) username!: string;
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(PASSWORD_MAX_LENGTH) password!: string;
}

class ChangePasswordDto {
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(PASSWORD_MAX_LENGTH) currentPassword!: string;
  /** Length policy is checked by the service so every path (self, admin reset) shares one rule. */
  @ApiProperty() @IsString() @MaxLength(PASSWORD_MAX_LENGTH) newPassword!: string;
}

class ResetPasswordDto {
  @ApiProperty() @IsString() @MaxLength(PASSWORD_MAX_LENGTH) temporaryPassword!: string;
}

class AccountStatusDto {
  @ApiProperty() @IsBoolean() isActive!: boolean;
}

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly accounts: AccountSecurityService) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  login(@Body() dto: LoginDto, @Req() req: Request) {
    return this.accounts.login(dto.username, dto.password, req.ip);
  }

  @ApiBearerAuth()
  @AllowedBeforePasswordChange()
  @Get('me')
  me(@Req() req: AuthedRequest): Omit<CurrentUser, 'sessionId'> {
    const { sessionId: _sid, ...me } = req.user;
    return me;
  }

  @ApiBearerAuth()
  @AllowedBeforePasswordChange()
  @Post('logout')
  @HttpCode(204)
  logout(@Req() req: AuthedRequest) {
    return this.accounts.logout(req.user.id, req.user.sessionId!);
  }

  /** Ends every session, including this one; the client signs in again (F-OA0-01). */
  @ApiBearerAuth()
  @AllowedBeforePasswordChange()
  @Post('change-password')
  @HttpCode(204)
  changePassword(@Req() req: AuthedRequest, @Body() dto: ChangePasswordDto) {
    return this.accounts.changePassword({ id: req.user.id, sessionId: req.user.sessionId }, dto.currentPassword, dto.newPassword);
  }
}

const actor = (req: AuthedRequest) => ({ id: req.user.id, sessionId: req.user.sessionId });

/** OA1.2 account security operations; the full User Management screen and API come with OA2. */
@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin/users/:id')
export class AccountAdminController {
  constructor(private readonly accounts: AccountSecurityService) {}

  @Get('account')
  @RequirePermissions('USER.VIEW')
  state(@Param('id', ParseIntPipe) id: number) {
    return this.accounts.accountState(id);
  }

  @Post('reset-password')
  @HttpCode(204)
  @RequirePermissions('USER.MANAGE')
  resetPassword(@Req() req: AuthedRequest, @Param('id', ParseIntPipe) id: number, @Body() dto: ResetPasswordDto) {
    return this.accounts.resetPassword(actor(req), id, dto.temporaryPassword);
  }

  @Patch('account-status')
  @HttpCode(204)
  @RequirePermissions('USER.MANAGE')
  setStatus(@Req() req: AuthedRequest, @Param('id', ParseIntPipe) id: number, @Body() dto: AccountStatusDto) {
    return this.accounts.setAccountStatus(actor(req), id, dto.isActive);
  }

  @Post('unlock')
  @HttpCode(204)
  @RequirePermissions('USER.MANAGE')
  unlock(@Req() req: AuthedRequest, @Param('id', ParseIntPipe) id: number) {
    return this.accounts.unlock(actor(req), id);
  }
}
