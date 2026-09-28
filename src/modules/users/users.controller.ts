import { Controller, Get, Delete, UseGuards } from '@nestjs/common';
import { UsersService } from './users.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser, CurrentUserData } from '../../common/decorators/current-user.decorator';

@Controller('api/v1/users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  async getMe(@CurrentUser() user: CurrentUserData) {
    return this.usersService.getMe(user.id);
  }

  @Delete('me')
  async deleteAccount(@CurrentUser() user: CurrentUserData) {
    return this.usersService.deleteAccount(user.id);
  }
}
