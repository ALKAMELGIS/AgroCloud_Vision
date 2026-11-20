import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * يتحقق من صحة JWT على كل مسار محمي، ويحقن req.user
 * بالحمولة (userId, organizationId, role, email) القادمة من JwtStrategy.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}
