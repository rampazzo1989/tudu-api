import { Body, Controller, Post, HttpCode, HttpStatus } from '@nestjs/common';
import { AuthService } from './auth.service';
import { GoogleLoginDto } from './dto/google-login.dto';
import { AppleLoginDto } from './dto/apple-login.dto';
import { DevLoginDto } from './dto/dev-login.dto';

@Controller('api/v1/auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('google')
  @HttpCode(HttpStatus.OK)
  async loginWithGoogle(@Body() dto: GoogleLoginDto) {
    return this.authService.loginWithGoogle(dto);
  }

  @Post('apple')
  @HttpCode(HttpStatus.OK)
  async loginWithApple(@Body() dto: AppleLoginDto) {
    return this.authService.loginWithApple(dto);
  }

  @Post('dev')
  @HttpCode(HttpStatus.OK)
  async devLogin(@Body() dto: DevLoginDto) {
    return this.authService.devLogin(dto);
  }
}
