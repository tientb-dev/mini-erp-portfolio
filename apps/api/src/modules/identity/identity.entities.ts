import { Column, Entity, JoinTable, ManyToMany, PrimaryGeneratedColumn } from 'typeorm';
import { Warehouse } from '../master-data/master-data.entities';

@Entity('permissions')
export class Permission {
  @PrimaryGeneratedColumn() id!: number;
  @Column({ unique: true }) code!: string;
}

@Entity('roles')
export class Role {
  @PrimaryGeneratedColumn() id!: number;
  @Column({ unique: true }) code!: string;
  @Column() name!: string;
  @ManyToMany(() => Permission)
  @JoinTable({ name: 'role_permissions', joinColumn: { name: 'role_id' }, inverseJoinColumn: { name: 'permission_id' } })
  permissions!: Permission[];
}

@Entity('users')
export class User {
  @PrimaryGeneratedColumn() id!: number;
  @Column({ unique: true }) username!: string;
  @Column({ name: 'password_hash', select: false }) passwordHash!: string;
  @Column({ name: 'full_name' }) fullName!: string;
  @Column({ name: 'is_active', default: true }) isActive!: boolean;
  @ManyToMany(() => Role)
  @JoinTable({ name: 'user_roles', joinColumn: { name: 'user_id' }, inverseJoinColumn: { name: 'role_id' } })
  roles!: Role[];
  @ManyToMany(() => Warehouse)
  @JoinTable({ name: 'user_warehouses', joinColumn: { name: 'user_id' }, inverseJoinColumn: { name: 'warehouse_id' } })
  warehouses!: Warehouse[];
}
