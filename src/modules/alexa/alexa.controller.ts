import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Response, Request } from 'express';
import { SkipThrottle } from '@nestjs/throttler';
import { AlexaService } from './alexa.service';
import { AlexaTokenDto, VerifyPairingCodeDto } from './dto/alexa.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser, CurrentUserData } from '../../common/decorators/current-user.decorator';

@Controller('api/v1/alexa')
export class AlexaController {
  constructor(private readonly alexaService: AlexaService) {}

  // ==========================================
  // ALEXA SKILL WEBHOOK
  // ==========================================

  @Post()
  @SkipThrottle()
  @HttpCode(HttpStatus.OK)
  async handleWebhook(@Body() body: any) {
    return this.alexaService.handleAlexaWebhook(body);
  }

  // ==========================================
  // ACCOUNT LINKING: AUTH PAGE (WEBVIEW)
  // ==========================================

  @Get('auth')
  @SkipThrottle()
  renderAuthPage(
    @Query('client_id') clientId: string,
    @Query('response_type') responseType: string,
    @Query('state') state: string,
    @Query('redirect_uri') redirectUri: string,
    @Res() res: Response,
  ) {
    const html = this.generateAuthHtml({
      clientId: clientId || '',
      state: state || '',
      redirectUri: redirectUri || '',
      errorMessage: null,
    });
    return res.type('html').send(html);
  }

  @Post('auth/authorize')
  @SkipThrottle()
  async handleAuthorize(
    @Body() body: VerifyPairingCodeDto,
    @Res() res: Response,
  ) {
    try {
      const authCode = await this.alexaService.verifyPairingCode(body);
      const targetUrl = new URL(body.redirect_uri);
      targetUrl.searchParams.set('code', authCode);
      targetUrl.searchParams.set('state', body.state);

      return res.redirect(HttpStatus.FOUND, targetUrl.toString());
    } catch (err: any) {
      const html = this.generateAuthHtml({
        clientId: body.client_id || '',
        state: body.state || '',
        redirectUri: body.redirect_uri || '',
        errorMessage: err.message || 'Código de vinculação inválido ou expirado.',
      });
      return res.type('html').status(HttpStatus.UNAUTHORIZED).send(html);
    }
  }

  // ==========================================
  // ACCOUNT LINKING: TOKEN EXCHANGE
  // ==========================================

  @Post('token')
  @SkipThrottle()
  @HttpCode(HttpStatus.OK)
  async exchangeToken(@Body() body: any) {
    // Alexa can send either JSON or application/x-www-form-urlencoded
    const dto: AlexaTokenDto = {
      grant_type: body.grant_type,
      code: body.code,
      client_id: body.client_id,
      client_secret: body.client_secret,
      redirect_uri: body.redirect_uri,
    };
    return this.alexaService.exchangeToken(dto);
  }

  // ==========================================
  // MOBILE / WEB APP INTEGRATION ENDPOINTS
  // ==========================================

  @Post('pairing-code')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async generatePairingCode(@CurrentUser() user: CurrentUserData) {
    return this.alexaService.generatePairingCode(user.id);
  }

  @Get('status')
  @UseGuards(JwtAuthGuard)
  async getStatus(@CurrentUser() user: CurrentUserData) {
    return this.alexaService.getAlexaStatus(user.id);
  }

  @Post('unlink')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async unlink(@CurrentUser() user: CurrentUserData) {
    return this.alexaService.unlinkAlexa(user.id);
  }

  // ==========================================
  // AUTH HTML TEMPLATE
  // ==========================================

  private generateAuthHtml(params: {
    clientId: string;
    state: string;
    redirectUri: string;
    errorMessage: string | null;
  }): string {
    const { clientId, state, redirectUri, errorMessage } = params;

    return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>Vincular Tudú com a Alexa</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
    body {
      background-color: #0F172A;
      color: #F8FAFC;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      padding: 24px;
    }
    .card {
      background: #1E293B;
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 20px;
      padding: 32px 24px;
      max-width: 420px;
      width: 100%;
      box-shadow: 0 20px 40px rgba(0, 0, 0, 0.4);
      text-align: center;
    }
    .logo-container {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 12px;
      margin-bottom: 24px;
    }
    .badge {
      background: #6366F1;
      width: 48px;
      height: 48px;
      border-radius: 14px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 26px;
      box-shadow: 0 8px 16px rgba(99, 102, 241, 0.35);
    }
    .alexa-icon {
      font-size: 32px;
    }
    h1 {
      font-size: 22px;
      font-weight: 700;
      margin-bottom: 8px;
      color: #FFFFFF;
    }
    p.subtitle {
      font-size: 14px;
      color: #94A3B8;
      line-height: 1.5;
      margin-bottom: 24px;
    }
    .instructions {
      background: rgba(15, 23, 42, 0.6);
      border-radius: 12px;
      padding: 16px;
      text-align: left;
      margin-bottom: 24px;
      font-size: 13px;
      color: #CBD5E1;
      line-height: 1.6;
    }
    .instructions ol {
      margin-left: 20px;
    }
    .instructions li {
      margin-bottom: 6px;
    }
    .instructions strong {
      color: #A5B4FC;
    }
    .input-group {
      margin-bottom: 24px;
    }
    label {
      display: block;
      font-size: 13px;
      font-weight: 600;
      color: #CBD5E1;
      margin-bottom: 8px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    input[type="text"] {
      width: 100%;
      height: 60px;
      background: #0F172A;
      border: 2px solid #334155;
      border-radius: 14px;
      color: #FFFFFF;
      font-size: 28px;
      font-weight: 700;
      letter-spacing: 8px;
      text-align: center;
      outline: none;
      transition: all 0.2s ease;
    }
    input[type="text"]:focus {
      border-color: #6366F1;
      box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.25);
    }
    .btn-submit {
      width: 100%;
      height: 52px;
      background: linear-gradient(135deg, #6366F1, #8B5CF6);
      border: none;
      border-radius: 14px;
      color: #FFFFFF;
      font-size: 16px;
      font-weight: 600;
      cursor: pointer;
      box-shadow: 0 10px 20px rgba(99, 102, 241, 0.35);
      transition: transform 0.1s ease, box-shadow 0.2s ease;
    }
    .btn-submit:active {
      transform: scale(0.98);
    }
    .alert-error {
      background: rgba(239, 68, 68, 0.15);
      border: 1px solid #EF4444;
      border-radius: 10px;
      padding: 12px;
      margin-bottom: 20px;
      color: #FCA5A5;
      font-size: 13px;
      line-height: 1.4;
    }
    footer {
      margin-top: 24px;
      font-size: 12px;
      color: #64748B;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo-container">
      <div class="badge">📝</div>
      <span style="font-size: 20px; color: #64748B;">+</span>
      <div class="alexa-icon">🗣️</div>
    </div>

    <h1>Conectar Tudú à Alexa</h1>
    <p class="subtitle">Acesse suas tarefas de hoje e adicione novos tudús diretamente pelos seus dispositivos Echo.</p>

    ${errorMessage ? `<div class="alert-error">⚠️ ${errorMessage}</div>` : ''}

    <div class="instructions">
      <ol>
        <li>Abra o aplicativo <strong>Tudú</strong> no celular ou web</li>
        <li>Vá em <strong>Configurações &gt; Alexa</strong></li>
        <li>Toque em <strong>Gerar Código de Vinculação</strong></li>
        <li>Digite o código de 6 dígitos gerado:</li>
      </ol>
    </div>

    <form method="POST" action="/api/v1/alexa/auth/authorize">
      <input type="hidden" name="client_id" value="${clientId}">
      <input type="hidden" name="state" value="${state}">
      <input type="hidden" name="redirect_uri" value="${redirectUri}">

      <div class="input-group">
        <label for="code">Código de 6 dígitos</label>
        <input
          id="code"
          type="text"
          name="code"
          inputmode="numeric"
          pattern="[0-9]*"
          maxlength="6"
          placeholder="000000"
          autofocus
          required
        >
      </div>

      <button type="submit" class="btn-submit">Vincular Conta</button>
    </form>
  </div>

  <footer>
    Tudú &copy; ${new Date().getFullYear()} &bull; Todos os direitos reservados
  </footer>
</body>
</html>`;
  }
}
