import {
  ConflictException,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { UsersService } from '../users/users.service';
import { OrganizationsService } from '../organizations/organizations.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { Role } from '../common/decorators/roles.decorator';

@Injectable()
export class AuthService implements OnApplicationBootstrap {
  private readonly logger = new Logger('AuthService');

  constructor(
    private readonly usersService: UsersService,
    private readonly organizationsService: OrganizationsService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * حساب المالك الافتراضي: يُنشأ تلقائياً عند تشغيل الخادم إن لم يكن موجوداً،
   * وإن كان موجوداً يُعاد ضبطه كمالك نشط بكلمة السر المحددة.
   * يمكن تغييره من متغيرات البيئة OWNER_EMAIL / OWNER_PASSWORD.
   */
  async onApplicationBootstrap() {
    const email = this.configService.get('OWNER_EMAIL') || 'demo@agrocloud.test';
    const password = this.configService.get('OWNER_PASSWORD') || 'Demo12345!';
    const passwordHash = await bcrypt.hash(password, 10);

    const existing = await this.usersService.findByEmail(email);
    if (existing) {
      existing.role = Role.OWNER;
      existing.isActive = true;
      existing.passwordHash = passwordHash;
      await this.usersService.save(existing);
      this.logger.log(`Owner account ready: ${email}`);
      return;
    }

    const organization = await this.organizationsService.create(
      this.configService.get('OWNER_ORGANIZATION') || 'AgroCloud Vision',
    );
    await this.usersService.create({
      email,
      fullName: 'Owner',
      passwordHash,
      role: Role.OWNER,
      organizationId: organization.id,
    });
    this.logger.log(`Owner account created: ${email}`);
  }

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

  /**
   * Swaps a valid refresh token for a new access + refresh pair, so a session
   * outlives the short access token without asking for the password again.
   * The user must still exist and be active.
   */
  async refresh(refreshToken: string) {
    if (!refreshToken || typeof refreshToken !== 'string') throw new UnauthorizedException('Session expired');
    let payload: { sub: string };
    try {
      payload = this.jwtService.verify(refreshToken, { secret: this.configService.get('JWT_REFRESH_SECRET') });
    } catch {
      throw new UnauthorizedException('Session expired');
    }
    const user = await this.usersService.findById(payload.sub);
    if (!user || !user.isActive) throw new UnauthorizedException('Session expired');
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
