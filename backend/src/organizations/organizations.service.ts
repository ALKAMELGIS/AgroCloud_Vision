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

  findById(id: string) {
    return this.orgRepo.findOne({ where: { id } });
  }
}
