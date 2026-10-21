import { Controller, Get, Res } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';

@ApiTags('Health')
@Controller()
export class AppController {
  @Get(['', 'health'])
  @ApiOperation({ summary: 'Health check and service status' })
  @ApiResponse({ status: 200, description: 'Service is healthy' })
  getHealth() {
    return {
      status: 'ok',
      service: 'tudu-api',
      timestamp: new Date().toISOString(),
    };
  }

  @Get('privacy')
  @ApiOperation({ summary: 'Privacy policy page' })
  getPrivacy(@Res() res: Response) {
    const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Política de Privacidade - Tudú</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
    body { background-color: #0F172A; color: #E2E8F0; line-height: 1.6; padding: 40px 20px; display: flex; justify-content: center; }
    .container { max-width: 760px; width: 100%; background: #1E293B; padding: 40px; border-radius: 16px; border: 1px solid rgba(255, 255, 255, 0.08); box-shadow: 0 20px 40px rgba(0, 0, 0, 0.4); }
    .badge { display: inline-block; background: rgba(16, 185, 129, 0.15); color: #34D399; font-size: 13px; font-weight: 600; padding: 6px 12px; border-radius: 20px; margin-bottom: 20px; border: 1px solid rgba(16, 185, 129, 0.3); }
    h1 { font-size: 28px; color: #FFFFFF; margin-bottom: 8px; }
    .last-updated { font-size: 13px; color: #94A3B8; margin-bottom: 24px; }
    p { margin-bottom: 16px; font-size: 15px; color: #CBD5E1; }
    h2 { font-size: 18px; color: #F8FAFC; margin: 28px 0 12px 0; border-bottom: 1px solid rgba(255, 255, 255, 0.08); padding-bottom: 6px; }
    ul { margin-left: 20px; margin-bottom: 16px; }
    li { margin-bottom: 8px; font-size: 14px; color: #CBD5E1; }
    footer { margin-top: 40px; padding-top: 20px; border-top: 1px solid rgba(255, 255, 255, 0.08); font-size: 13px; color: #64748B; text-align: center; }
  </style>
</head>
<body>
  <div class="container">
    <div class="badge">🛡️ LGPD & GDPR Compliant</div>
    <h1>Política de Privacidade do Tudú</h1>
    <div class="last-updated">Última atualização: Outubro de 2026</div>

    <p>O <strong>Tudú</strong> foi projetado com privacidade por padrão. Suas listas, tarefas e anotações pertencem exclusivamente a você: nós nunca vendemos seus dados nem exibimos anúncios.</p>

    <h2>1. Compromisso com a Privacidade</h2>
    <p>O Tudú é um aplicativo de organização e produtividade offline-first. Nós operamos sob um princípio simples: seus dados são seus. Não rastreamos seus hábitos de navegação, não criamos perfis publicitários e não comercializamos nenhuma informação com terceiros.</p>

    <h2>2. Informações que Coletamos</h2>
    <p>Coletamos apenas o estritamente necessário para o funcionamento do app e seus recursos:</p>
    <ul>
      <li><strong>Dados de Conta (Opcional):</strong> Ao conectar sua conta Google ou Apple para sincronização na nuvem ou vincular à assistente de voz (Alexa), recebemos seu e-mail e identificador de usuário para autenticar suas requisições de forma segura.</li>
      <li><strong>Listas e Tarefas:</strong> Títulos de listas, itens, etiquetas, datas e horários de lembrete criados por você. Esses dados são salvos localmente e transmitidos com segurança sob criptografia SSL/TLS.</li>
      <li><strong>Integração com Assistentes (Alexa):</strong> O uso da skill da Alexa requer autorização prévia por código de 6 dígitos (OAuth 2.0). Apenas as tarefas solicitadas por voz são consultadas ou criadas no seu perfil.</li>
    </ul>

    <h2>3. Armazenamento e Criptografia</h2>
    <p>Toda a comunicação com nossos servidores é realizada exclusivamente através de HTTPS com criptografia TLS 1.3. Nossos bancos de dados utilizam criptografia em repouso (AES-256).</p>

    <h2>4. Recursos de Inteligência Artificial</h2>
    <p>Quando você utiliza recursos de IA (como sugestão de itens ou organização inteligente), apenas os termos necessários são processados em tempo real. Seus dados e tarefas <strong>nunca</strong> são utilizados para treinamento de modelos públicos de inteligência artificial.</p>

    <h2>5. Seus Direitos (LGPD & GDPR)</h2>
    <p>Em conformidade com a legislação aplicável, você tem total direito de acessar e exportar seus dados, revogar permissões e excluir sua conta a qualquer momento.</p>

    <h2>6. Contato</h2>
    <p>Para dúvidas sobre esta política, entre em contato através de: <strong>rampazzo1989@gmail.com</strong>.</p>

    <footer>
      Tudú &bull; Todos os direitos reservados &bull; 2026
    </footer>
  </div>
</body>
</html>`;
    return res.type('html').send(html);
  }
}
