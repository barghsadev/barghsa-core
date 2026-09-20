import { Module } from '@nestjs/common';
import { StaffAssignmentService } from './staff-assignment.service.js';
@Module({ providers: [StaffAssignmentService], exports: [StaffAssignmentService] })
export class StaffAssignmentModule {}
