import { SetMetadata } from '@nestjs/common';

export enum Role {
  OWNER = 'owner',
  MANAGER = 'manager',
  GIS_ANALYST = 'gis_analyst',
  AGRONOMIST = 'agronomist',
  FIELD_SUPERVISOR = 'field_supervisor',
  VIEWER = 'viewer',
}

export const ROLES_KEY = 'roles';
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
