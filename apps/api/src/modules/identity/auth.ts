import {
  Body, CanActivate, Controller, ExecutionContext, Get, HttpCode, Injectable, Post, Req, SetMetadata, UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { ApiBearerAuth, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';
import { Request } from 'express';
import { Repository } from 'typeorm';
import { User } from './identity.entities';
import { verifyPassword } from './password';

/** Resolved on every request; permissions and warehouse scope come from the DB, not the token. */
export interface CurrentUser {
  id: number;
  username: string;
  fullName: string;
  permissions: string[];
  warehouseIds: number[];
}

export type AuthedRequest = Request & { user: CurrentUser };

const PERMISSIONS_KEY = 'permissions';
const PUBLIC_KEY = 'public';
/** All listed FUNCTION.ACTION permissions are required. */
export const RequirePermissions = (...codes: string[]) => SetMetadata(PERMISSIONS_KEY, codes);
export const Public = () => SetMetadata(PUBLIC_KEY, true);

@Injectable()
export class IdentityService {
  constructor(@InjectRepository(User) private readonly users: Repository<User>) {}

  async loadCurrentUser(id: number): Promise<CurrentUser | null> {
    const user = await this.users.findOne({
      where: { id, isActive: true },
      relations: { roles: { permissions: true }, warehouses: true },
    });
    if (!user) return null;
    const permissions = [...new Set(user.roles.flatMap((r) => r.permissions.map((p) => p.code)))];
    return { id: user.id, username: user.username, fullName: user.fullName, permissions, warehouseIds: user.warehouses.map((w) => w.id) };
  }

  async checkCredentials(username: string, password: string): Promise<number | null> {
    const user = await this.users.findOne({ where: { username, isActive: true }, select: { id: true, passwordHash: true } });
    return user && (await verifyPassword(password, user.passwordHash)) ? user.id : null;
  }
}

/** Global guard: authentication (Bearer JWT) + RBAC FUNCTION.ACTION (ADR-0006). */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly jwt: JwtService, private readonly identity: IdentityService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, targets)) return true;

    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const token = req.headers.authorization?.replace(/^Bearer /, '');
    if (!token) throw new UnauthorizedException();
    let userId: number;
    try {
      userId = (await this.jwt.verifyAsync<{ sub: number }>(token)).sub;
    } catch {
      throw new UnauthorizedException();
    }
    const user = await this.identity.loadCurrentUser(userId);
    if (!user) throw new UnauthorizedException();
    req.user = user;

    const required = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, targets) ?? [];
    const missing = required.filter((p) => !user.permissions.includes(p));
    if (missing.length) throw new ForbiddenException(`Missing permission: ${missing.join(', ')}`);
    return true;
  }
}

class LoginDto {
  @ApiProperty() @IsString() @IsNotEmpty() username!: string;
  @ApiProperty() @IsString() @IsNotEmpty() password!: string;
}

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly identity: IdentityService, private readonly jwt: JwtService) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(@Body() dto: LoginDto): Promise<{ accessToken: string }> {
    const userId = await this.identity.checkCredentials(dto.username, dto.password);
    if (!userId) throw new UnauthorizedException('Invalid username or password');
    return { accessToken: await this.jwt.signAsync({ sub: userId }) };
  }

  @ApiBearerAuth()
  @Get('me')
  me(@Req() req: AuthedRequest): CurrentUser {
    return req.user;
  }
}
