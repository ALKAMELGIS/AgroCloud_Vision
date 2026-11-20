import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { UsersService } from '../users/users.service';
import { OrganizationsService } from '../organizations/organizations.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { Role } from '../common/decorators/roles.decorator';

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly organizationsService: OrganizationsService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * تسجيل مؤسسة جديدة + أول مستخدم بدور Owner (أول مستخدم في المنصة لهذه المؤسسة).
   */
  async register(dto: RegisterDto) {
    const existing = await this.usersService.findByEmail(dto.email);
    if (existing) {
      throw new ConflictException('البريد الإلكتروني مستخدم بالفعل');
    }

    const organization = await this.organizationsService.create(dto.organizationName);
    const passwordHash = await bcrypt.hash(dto.password, 10);

    const user = await this.usersService.create({
      email: dto.email,
      fullName: dto.fullName,
      passwordHash,
      role: Role.OWNER,
      organizationId: organization.id,
    });

    return this.buildTokens(user.id, organization.id, user.role, user.email);
  }

  async login(dto: LoginDto) {
    const user = await this.usersService.findByEmail(dto.email);
    if (!user || !user.isActive) {
      throw new UnauthorizedException('بيانات الدخول غير صحيحة');
    }

    const passwordValid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!passwordValid) {
      throw new UnauthorizedException('بيانات الدخول غير صحيحة');
    }

    return this.buildTokens(user.id, user.organizationId, user.role, user.email);
  }

  private buildTokens(userId: string, organizationId: string, role: string, email: string) {
    const payload = { sub: userId, organizationId, role, email };

    const accessToken = this.jwtService.sign(payload, {
      secret: this.configService.get('JWT_ACCESS_SECRET'),
      expiresIn: this.configService.get('JWT_ACCESS_EXPIRES') || '15m',
    });

    const refreshToken = this.jwtService.sign(payload, {
      secret: this.configService.get('JWT_REFRESH_SECRET'),
      expiresIn: this.configService.get('JWT_REFRESH_EXPIRES') || '7d',
    });

    return {
      accessToken,
      refreshToken,
      user: { id: userId, organizationId, role, email },
    };
  }
}
