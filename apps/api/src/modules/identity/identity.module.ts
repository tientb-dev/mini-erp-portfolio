import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { env } from '../../database/env';
import { AuthController, IdentityService } from './auth';
import { Permission, Role, User } from './identity.entities';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, Role, Permission]),
    JwtModule.register({ secret: env('JWT_ACCESS_SECRET'), signOptions: { expiresIn: (process.env.JWT_ACCESS_TTL ?? '8h') as '8h' } }),
  ],
  controllers: [AuthController],
  providers: [IdentityService],
  exports: [IdentityService, JwtModule],
})
export class IdentityModule {}
