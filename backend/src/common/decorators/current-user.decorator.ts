import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export interface CurrentUserPayload {
  userId: string;
  organizationId: string;
  role: string;
  email: string;
}

/**
 * يستخرج المستخدم الحالي (المصادَق عليه عبر JWT) من الطلب.
 * يحمل دائماً organizationId لفرض عزل بيانات متعدد المستأجرين (Multi-Tenant).
 */
export const CurrentUser = createParamDecorator(
  (data: keyof CurrentUserPayload | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const user = request.user as CurrentUserPayload;
    return data ? user?.[data] : user;
  },
);
