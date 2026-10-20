import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import {
  ALEXA_INTENTS,
  ALEXA_PAIRING_TTL_MS,
  ALEXA_AUTH_CODE_TTL_SECONDS,
  ALEXA_ACCESS_TOKEN_TTL_SECONDS,
} from './alexa.constants';
import { AlexaTokenDto, VerifyPairingCodeDto } from './dto/alexa.dto';

interface PairingInfo {
  userId: string;
  email: string;
  expiresAt: number;
}

@Injectable()
export class AlexaService {
  private readonly logger = new Logger(AlexaService.name);
  private readonly pairingCodes = new Map<string, PairingInfo>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  // ==========================================
  // ACCOUNT LINKING & PAIRING CODES
  // ==========================================

  async generatePairingCode(userId: string): Promise<{ code: string; expiresInSeconds: number }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    // Generate 6-digit numeric pairing code (100000 - 999999)
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = Date.now() + ALEXA_PAIRING_TTL_MS;

    this.pairingCodes.set(code, {
      userId: user.id,
      email: user.email,
      expiresAt,
    });

    // Also persist in UserSettings for multi-instance resilience
    const existingSettings = await this.prisma.userSettings.findUnique({
      where: { userId },
    });

    const generalSettings = (existingSettings?.generalSettings as Record<string, any>) || {};
    generalSettings.alexaPairing = { code, expiresAt };

    await this.prisma.userSettings.upsert({
      where: { userId },
      update: { generalSettings },
      create: { userId, generalSettings },
    });

    this.logger.log(`Generated Alexa pairing code for user ${user.email}`);

    return {
      code,
      expiresInSeconds: Math.floor(ALEXA_PAIRING_TTL_MS / 1000),
    };
  }

  async verifyPairingCode(dto: VerifyPairingCodeDto): Promise<string> {
    const cleanCode = dto.code.trim().replace(/\D/g, '');
    let pairing = this.pairingCodes.get(cleanCode);

    // If not found in memory, check database
    if (!pairing || pairing.expiresAt < Date.now()) {
      const settings = await this.prisma.userSettings.findFirst({
        where: {
          generalSettings: {
            path: ['alexaPairing', 'code'],
            equals: cleanCode,
          },
        },
        include: { user: true },
      });

      if (settings?.user) {
        const pairingData = (settings.generalSettings as any)?.alexaPairing;
        if (pairingData && pairingData.expiresAt > Date.now()) {
          pairing = {
            userId: settings.user.id,
            email: settings.user.email,
            expiresAt: pairingData.expiresAt,
          };
        }
      }
    }

    if (!pairing || pairing.expiresAt < Date.now()) {
      throw new UnauthorizedException('Código de vinculação inválido ou expirado');
    }

    // Invalidate code
    this.pairingCodes.delete(cleanCode);

    // Generate short-lived authorization code (JWT)
    const authCode = this.jwtService.sign(
      {
        sub: pairing.userId,
        email: pairing.email,
        type: 'alexa_auth_code',
      },
      { expiresIn: ALEXA_AUTH_CODE_TTL_SECONDS },
    );

    return authCode;
  }

  async exchangeToken(dto: AlexaTokenDto) {
    if (dto.grant_type !== 'authorization_code') {
      throw new UnauthorizedException(`Unsupported grant_type: ${dto.grant_type}`);
    }

    try {
      const payload = this.jwtService.verify(dto.code);
      if (payload.type !== 'alexa_auth_code' || !payload.sub) {
        throw new UnauthorizedException('Invalid authorization code');
      }

      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
      });

      if (!user) {
        throw new UnauthorizedException('User not found');
      }

      // Mark Alexa as linked in settings
      const settings = await this.prisma.userSettings.findUnique({
        where: { userId: user.id },
      });
      const generalSettings = (settings?.generalSettings as Record<string, any>) || {};
      generalSettings.alexaLinked = true;
      generalSettings.alexaLinkedAt = new Date().toISOString();

      await this.prisma.userSettings.upsert({
        where: { userId: user.id },
        update: { generalSettings },
        create: { userId: user.id, generalSettings },
      });

      const accessToken = this.jwtService.sign(
        { sub: user.id, email: user.email },
        { expiresIn: `${ALEXA_ACCESS_TOKEN_TTL_SECONDS}s` },
      );

      this.logger.log(`Alexa token exchanged successfully for ${user.email}`);

      return {
        access_token: accessToken,
        token_type: 'Bearer',
        expires_in: ALEXA_ACCESS_TOKEN_TTL_SECONDS,
      };
    } catch (err: any) {
      this.logger.warn(`Failed to exchange Alexa token: ${err?.message}`);
      throw new UnauthorizedException('Invalid or expired code');
    }
  }

  async getAlexaStatus(userId: string): Promise<{ isLinked: boolean; linkedAt?: string }> {
    const settings = await this.prisma.userSettings.findUnique({
      where: { userId },
    });
    const general = (settings?.generalSettings as any) || {};
    return {
      isLinked: !!general.alexaLinked,
      linkedAt: general.alexaLinkedAt,
    };
  }

  async unlinkAlexa(userId: string): Promise<{ success: boolean }> {
    const settings = await this.prisma.userSettings.findUnique({
      where: { userId },
    });
    if (settings) {
      const generalSettings = (settings.generalSettings as Record<string, any>) || {};
      delete generalSettings.alexaLinked;
      delete generalSettings.alexaLinkedAt;
      delete generalSettings.alexaPairing;

      await this.prisma.userSettings.update({
        where: { userId },
        data: { generalSettings },
      });
    }
    return { success: true };
  }

  // ==========================================
  // WEBHOOK REQUEST DISPATCHER
  // ==========================================

  async handleAlexaWebhook(body: any): Promise<any> {
    const request = body?.request;
    const requestType = request?.type;

    if (!requestType) {
      return this.buildResponse('Requisição inválida da Alexa.', true);
    }

    if (requestType === 'SessionEndedRequest') {
      return { version: '1.0', response: {} };
    }

    // Authenticate user from Alexa Access Token
    const accessToken =
      body?.context?.System?.user?.accessToken || body?.session?.user?.accessToken;

    if (!accessToken) {
      return this.buildAccountLinkingResponse();
    }

    let user: any = null;
    try {
      const payload = this.jwtService.verify(accessToken);
      if (payload?.sub) {
        user = await this.prisma.user.findUnique({
          where: { id: payload.sub },
        });
      }
    } catch {
      this.logger.warn('Invalid Alexa access token provided');
    }

    if (!user) {
      return this.buildAccountLinkingResponse();
    }

    // Dispatch by request type
    if (requestType === 'LaunchRequest') {
      return this.handleLaunchRequest(user);
    }

    if (requestType === 'IntentRequest') {
      const intentName = request.intent?.name;
      const slots = request.intent?.slots || {};

      switch (intentName) {
        case ALEXA_INTENTS.GET_TODAY_TASKS:
          return this.handleGetTodayTasks(user);

        case ALEXA_INTENTS.CREATE_TASK:
          return this.handleCreateTask(user, slots);

        case ALEXA_INTENTS.GET_NOTIFICATIONS:
          return this.handleGetNotifications(user);

        case ALEXA_INTENTS.HELP:
          return this.handleHelp();

        case ALEXA_INTENTS.CANCEL:
        case ALEXA_INTENTS.STOP:
          return this.handleStop();

        case ALEXA_INTENTS.FALLBACK:
        default:
          return this.handleFallback();
      }
    }

    return this.handleFallback();
  }

  // ==========================================
  // INTENT HANDLERS
  // ==========================================

  private async handleLaunchRequest(user: any) {
    const todayTasks = await this.getTodayTasksForUser(user.id);
    const count = todayTasks.length;

    let speech: string;
    if (count === 0) {
      speech =
        'Olá! Você não tem nenhuma tarefa pendente para hoje no Tudú. O que você gostaria de fazer? Você pode pedir para adicionar um novo tudú.';
    } else {
      const sample = todayTasks
        .slice(0, 3)
        .map((t, idx) => `${idx + 1}, ${t.title}`)
        .join('; ');
      speech = `Olá! Você tem ${count} ${
        count === 1 ? 'tarefa' : 'tarefas'
      } para hoje no Tudú. ${sample}. Deseja ouvir mais ou adicionar um novo tudú?`;
    }

    return this.buildResponse(
      speech,
      false,
      'Você pode perguntar quais são suas tarefas de hoje ou pedir para adicionar um tudú.',
    );
  }

  private async handleGetTodayTasks(user: any) {
    const todayTasks = await this.getTodayTasksForUser(user.id);
    const count = todayTasks.length;

    if (count === 0) {
      return this.buildResponse(
        'Você não tem nenhuma tarefa pendente para hoje no Tudú. Tudo em dia!',
        true,
      );
    }

    if (count <= 5) {
      const taskList = todayTasks.map((t) => t.title).join(', ');
      return this.buildResponse(
        `Você tem ${count} ${count === 1 ? 'tarefa' : 'tarefas'} para hoje no Tudú: ${taskList}.`,
        true,
      );
    }

    const firstFive = todayTasks.slice(0, 5).map((t) => t.title).join(', ');
    const remaining = count - 5;
    return this.buildResponse(
      `Você tem ${count} tarefas para hoje. As primeiras cinco são: ${firstFive}. E mais ${remaining} tarefas pendentes.`,
      true,
    );
  }

  private async handleCreateTask(user: any, slots: Record<string, any>) {
    const titleSlot = slots.taskTitle?.value;
    const dateSlot = slots.date?.value;
    const timeSlot = slots.time?.value;
    const listSlot = slots.listName?.value;

    if (!titleSlot || !titleSlot.trim()) {
      return this.buildResponse(
        'Qual tarefa você gostaria de adicionar no Tudú?',
        false,
        'Diga o que você quer que eu anote.',
      );
    }

    const taskTitle = titleSlot.trim().charAt(0).toUpperCase() + titleSlot.trim().slice(1);
    const { dueDate, hasTime, formattedSpeechDate } = this.parseAlexaDateTime(dateSlot, timeSlot);

    // Look for matching list if requested
    let targetListId: string | null = null;
    let listDisplayName: string | null = null;

    if (listSlot && listSlot.trim()) {
      const cleanListName = listSlot.trim().toLowerCase();
      const matchingList = await this.prisma.list.findFirst({
        where: {
          userId: user.id,
          deletedAt: null,
          name: { equals: cleanListName, mode: 'insensitive' },
        },
      });

      if (matchingList) {
        targetListId = matchingList.id;
        listDisplayName = matchingList.name;
      }
    }

    // Persist new task
    await this.prisma.task.create({
      data: {
        id: randomUUID(),
        userId: user.id,
        listId: targetListId,
        title: taskTitle,
        dueDate,
        hasTime,
        done: false,
        isUnlisted: !targetListId,
        order: 0,
      },
    });

    let speech: string;
    if (listDisplayName) {
      speech = `Pronto! Adicionei "${taskTitle}" na lista "${listDisplayName}".`;
    } else if (dateSlot || timeSlot) {
      speech = `Pronto! Anotei "${taskTitle}" para ${formattedSpeechDate}.`;
    } else {
      speech = `Pronto! Adicionei "${taskTitle}" nas suas tarefas de hoje.`;
    }

    return this.buildResponse(speech, true);
  }

  private async handleGetNotifications(user: any) {
    const now = new Date();
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);

    const overdueTasks = await this.prisma.task.findMany({
      where: {
        userId: user.id,
        done: false,
        deletedAt: null,
        isArchived: false,
        dueDate: {
          lt: startOfToday,
        },
      },
      orderBy: { dueDate: 'asc' },
      take: 5,
    });

    if (overdueTasks.length === 0) {
      return this.buildResponse(
        'Você não tem nenhuma tarefa atrasada ou notificação pendente no momento. Tudo em dia no Tudú!',
        true,
      );
    }

    const count = overdueTasks.length;
    const taskTitles = overdueTasks.map((t) => t.title).join(', ');
    return this.buildResponse(
      `Atenção: você tem ${count} ${
        count === 1 ? 'tarefa atrasada' : 'tarefas atrasadas'
      }: ${taskTitles}.`,
      true,
    );
  }

  private handleHelp() {
    const speech =
      'Com o Tudú na Alexa, você pode dizer: "quais são minhas tarefas de hoje", ' +
      '"adicionar comprar leite amanhã às dez da manhã", ou "quais tarefas estão atrasadas". ' +
      'O que você gostaria de fazer?';
    return this.buildResponse(speech, false, 'Você pode pedir para ler as tarefas de hoje ou adicionar um tudú.');
  }

  private handleStop() {
    return this.buildResponse('Até logo! Bom proveito com o Tudú.', true);
  }

  private handleFallback() {
    const speech =
      'Desculpe, não entendi. Você pode perguntar "quais são minhas tarefas de hoje" ou pedir "adicionar uma nova tarefa".';
    return this.buildResponse(speech, false, 'Como posso ajudar no seu Tudú?');
  }

  // ==========================================
  // HELPERS
  // ==========================================

  private async getTodayTasksForUser(userId: string) {
    const now = new Date();
    // End of today in local time
    const endOfToday = new Date(now);
    endOfToday.setHours(23, 59, 59, 999);

    return this.prisma.task.findMany({
      where: {
        userId,
        done: false,
        deletedAt: null,
        isArchived: false,
        dueDate: {
          lte: endOfToday,
        },
      },
      orderBy: [{ dueDate: 'asc' }, { order: 'asc' }],
      take: 10,
    });
  }

  private parseAlexaDateTime(
    dateSlot?: string,
    timeSlot?: string,
  ): { dueDate: Date; hasTime: boolean; formattedSpeechDate: string } {
    const now = new Date();
    let targetYear = now.getFullYear();
    let targetMonth = now.getMonth();
    let targetDay = now.getDate();
    let isToday = true;

    if (dateSlot && dateSlot !== 'PRESENT_REF') {
      // Formats like "2026-10-21" or "2026-W43"
      if (/^\d{4}-\d{2}-\d{2}$/.test(dateSlot)) {
        const parts = dateSlot.split('-').map((p) => parseInt(p, 10));
        targetYear = parts[0];
        targetMonth = parts[1] - 1;
        targetDay = parts[2];
        isToday =
          targetYear === now.getFullYear() &&
          targetMonth === now.getMonth() &&
          targetDay === now.getDate();
      }
    }

    let targetHour = 12;
    let targetMinute = 0;
    let hasTime = false;

    if (timeSlot) {
      if (/^\d{2}:\d{2}$/.test(timeSlot)) {
        const parts = timeSlot.split(':').map((p) => parseInt(p, 10));
        targetHour = parts[0];
        targetMinute = parts[1];
        hasTime = true;
      } else if (timeSlot === 'MO') {
        targetHour = 9;
        hasTime = true;
      } else if (timeSlot === 'AF') {
        targetHour = 14;
        hasTime = true;
      } else if (timeSlot === 'EV') {
        targetHour = 18;
        hasTime = true;
      } else if (timeSlot === 'NI') {
        targetHour = 21;
        hasTime = true;
      }
    }

    const dueDate = new Date(targetYear, targetMonth, targetDay, targetHour, targetMinute, 0);

    // Formatted speech representation in Portuguese
    let formattedSpeechDate = 'hoje';
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);

    if (isToday) {
      formattedSpeechDate = 'hoje';
    } else if (
      targetYear === tomorrow.getFullYear() &&
      targetMonth === tomorrow.getMonth() &&
      targetDay === tomorrow.getDate()
    ) {
      formattedSpeechDate = 'amanhã';
    } else {
      const monthNames = [
        'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
        'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
      ];
      formattedSpeechDate = `${targetDay} de ${monthNames[targetMonth]}`;
    }

    if (hasTime) {
      const minuteStr = targetMinute === 0 ? '' : ` e ${targetMinute}`;
      formattedSpeechDate += ` às ${targetHour} horas${minuteStr}`;
    }

    return { dueDate, hasTime, formattedSpeechDate };
  }

  private buildResponse(speechText: string, shouldEndSession: boolean, repromptText?: string) {
    return {
      version: '1.0',
      response: {
        outputSpeech: {
          type: 'PlainText',
          text: speechText,
        },
        ...(repromptText
          ? {
              reprompt: {
                outputSpeech: {
                  type: 'PlainText',
                  text: repromptText,
                },
              },
            }
          : {}),
        shouldEndSession,
      },
    };
  }

  private buildAccountLinkingResponse() {
    return {
      version: '1.0',
      response: {
        outputSpeech: {
          type: 'PlainText',
          text: 'Para usar o Tudú na Alexa, você precisa vincular sua conta no aplicativo da Alexa. Abri um cartão de vinculação no seu app.',
        },
        card: {
          type: 'LinkAccount',
        },
        shouldEndSession: true,
      },
    };
  }
}
