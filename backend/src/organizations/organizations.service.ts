import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Organization } from './organization.entity';

@Injectable()
export class OrganizationsService {
  constructor(
    @InjectRepository(Organization)
    private readonly orgRepo: Repository<Organization>,
  ) {}

  create(name: string) {
    const org = this.orgRepo.create({ name });
    return this.orgRepo.save(org);
  }

  /** One-time brand rename: organisations still named after the old brand. */
  renameLegacy(from: string, to: string) {
    return this.orgRepo.update({ name: from }, { name: to });
  }

  findById(id: string) {
    return this.orgRepo.findOne({ where: { id } });
  }
}
