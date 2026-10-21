import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import {
  ALEXA_INTENTS,
  ALEXA_LIST_EVENTS,
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

    // Alexa Household List Events and System Events are asynchronous out-of-session events.
    // They MUST NEVER return outputSpeech or cards (like LinkAccount), which causes Alexa
    // to fail list synchronization and say "Estou com problemas para acessar sua skill".
    if (
      requestType.startsWith('AlexaHouseholdListEvent.') ||
      requestType.startsWith('AlexaSkillEvent.') ||
      requestType.startsWith('SkillEnabled') ||
      requestType.startsWith('SkillDisabled') ||
      requestType.startsWith('SkillPermission')
    ) {
      return this.handleSystemOrListEvent(requestType, body);
    }

    // Authenticate user for interactive sessions (LaunchRequest, IntentRequest)
    const user = await this.resolveUserFromPayload(body);
    if (!user) {
      return this.buildAccountLinkingResponse();
    }

    // Associate Amazon Alexa userId with Tudú user for future background list events
    const amazonUserId = body?.context?.System?.user?.userId;
    if (amazonUserId) {
      this.associateAlexaUserId(user.id, amazonUserId).catch((err) =>
        this.logger.warn(`Could not associate Alexa userId: ${err?.message}`),
      );
    }

    // Dispatch by request type
    if (requestType === 'LaunchRequest') {
      return this.handleLaunchRequest(user);
    }

    if (requestType === 'IntentRequest') {
      const intentName = request.intent?.name;
      const slots = request.intent?.slots || {};
      const sessionAttributes = body?.session?.attributes || {};

      switch (intentName) {
        case ALEXA_INTENTS.GET_TODAY_TASKS:
          return this.handleGetTodayTasks(user, sessionAttributes);

        case ALEXA_INTENTS.YES:
          return this.handleReadMoreTasks(user, sessionAttributes);

        case ALEXA_INTENTS.NO:
          return this.handleStop(sessionAttributes);

        case ALEXA_INTENTS.CREATE_TASK:
          return this.handleCreateTask(user, slots, sessionAttributes);

        case ALEXA_INTENTS.GET_NOTIFICATIONS:
          return this.handleGetNotifications(user);

        case ALEXA_INTENTS.HELP:
          return this.handleHelp();

        case ALEXA_INTENTS.CANCEL:
        case ALEXA_INTENTS.STOP:
          return this.handleStop(sessionAttributes);

        case ALEXA_INTENTS.FALLBACK:
        default:
          return this.handleFallback(sessionAttributes, slots);
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
      return this.buildResponse(
        speech,
        false,
        'Você pode pedir para adicionar um novo tudú.',
        { awaitingMoreTasks: false, alreadyReadCount: 0 },
      );
    }

    if (count <= 3) {
      const sample = todayTasks
        .map((t, idx) => `${idx + 1}, ${t.title}`)
        .join('; ');
      speech = `Olá! Você tem ${count} ${
        count === 1 ? 'tarefa' : 'tarefas'
      } para hoje no Tudú: ${sample}. O que você gostaria de fazer? Você pode pedir para adicionar um novo tudú.`;
      return this.buildResponse(
        speech,
        false,
        'Você pode pedir para adicionar um novo tudú.',
        { awaitingMoreTasks: false, alreadyReadCount: count },
      );
    }

    const sample = todayTasks
      .slice(0, 3)
      .map((t, idx) => `${idx + 1}, ${t.title}`)
      .join('; ');
    speech = `Olá! Você tem ${count} tarefas para hoje no Tudú. As primeiras três são: ${sample}. Deseja ouvir mais ou adicionar um novo tudú?`;

    return this.buildResponse(
      speech,
      false,
      'Diga "ouvir mais" para ouvir as outras tarefas ou peça para adicionar uma nova tarefa.',
      { awaitingMoreTasks: true, alreadyReadCount: 3 },
    );
  }

  private async handleGetTodayTasks(user: any, sessionAttributes?: Record<string, any>) {
    if (sessionAttributes?.awaitingMoreTasks) {
      return this.handleReadMoreTasks(user, sessionAttributes);
    }

    const todayTasks = await this.getTodayTasksForUser(user.id);
    const count = todayTasks.length;

    if (count === 0) {
      return this.buildResponse(
        'Você não tem nenhuma tarefa pendente para hoje no Tudú. Tudo em dia!',
        true,
      );
    }

    if (count <= 5) {
      const taskList = todayTasks.map((t, idx) => `${idx + 1}, ${t.title}`).join('; ');
      return this.buildResponse(
        `Você tem ${count} ${count === 1 ? 'tarefa' : 'tarefas'} para hoje no Tudú: ${taskList}. Deseja adicionar um novo tudú?`,
        false,
        'Você pode pedir para adicionar um novo tudú.',
        { awaitingMoreTasks: false, alreadyReadCount: count },
      );
    }

    const firstFive = todayTasks
      .slice(0, 5)
      .map((t, idx) => `${idx + 1}, ${t.title}`)
      .join('; ');
    const remaining = count - 5;
    return this.buildResponse(
      `Você tem ${count} tarefas para hoje. As primeiras cinco são: ${firstFive}. Deseja ouvir mais ou adicionar um novo tudú?`,
      false,
      'Diga "ouvir mais" para ouvir as tarefas restantes.',
      { awaitingMoreTasks: true, alreadyReadCount: 5 },
    );
  }

  private async handleReadMoreTasks(user: any, sessionAttributes?: Record<string, any>) {
    const todayTasks = await this.getTodayTasksForUser(user.id);
    const count = todayTasks.length;
    const alreadyReadCount = sessionAttributes?.alreadyReadCount || 3;
    const remainingTasks = todayTasks.slice(alreadyReadCount);

    if (remainingTasks.length === 0) {
      const allTasksList = todayTasks.map((t, idx) => `${idx + 1}, ${t.title}`).join('; ');
      return this.buildResponse(
        `Essas eram todas as suas tarefas de hoje no Tudú: ${allTasksList}. Deseja adicionar um novo tudú?`,
        false,
        'Você pode pedir para adicionar um novo tudú.',
        { awaitingMoreTasks: false, alreadyReadCount: count },
      );
    }

    const remainingList = remainingTasks
      .map((t, idx) => `${alreadyReadCount + idx + 1}, ${t.title}`)
      .join('; ');

    const speech = `As tarefas restantes de hoje são: ${remainingList}. Total de ${count} ${
      count === 1 ? 'tarefa' : 'tarefas'
    } para hoje. Deseja adicionar um novo tudú?`;

    return this.buildResponse(
      speech,
      false,
      'Você pode pedir para adicionar um novo tudú ou dizer parar.',
      { awaitingMoreTasks: false, alreadyReadCount: count },
    );
  }

  private async handleCreateTask(
    user: any,
    slots: Record<string, any>,
    sessionAttributes?: Record<string, any>,
  ) {
    const rawTitleSlot = slots.taskTitle?.value;
    const dateSlot = slots.date?.value || sessionAttributes?.date;
    const timeSlot = slots.time?.value || sessionAttributes?.time;
    const listSlot = slots.listName?.value || sessionAttributes?.listName;

    // Guard: Prevent "ouvir mais", "sim", "não" from being treated as a task title
    if (
      this.isHearMorePhrase(rawTitleSlot) ||
      (sessionAttributes?.awaitingMoreTasks && this.isHearMorePhrase(rawTitleSlot))
    ) {
      return this.handleReadMoreTasks(user, sessionAttributes);
    }

    if (
      this.isNegativePhrase(rawTitleSlot) ||
      (sessionAttributes?.awaitingMoreTasks && this.isNegativePhrase(rawTitleSlot))
    ) {
      return this.handleStop(sessionAttributes);
    }

    const cleanedTitle = this.cleanTaskTitle(rawTitleSlot);

    if (
      this.isHearMorePhrase(cleanedTitle || undefined) ||
      (sessionAttributes?.awaitingMoreTasks && this.isHearMorePhrase(cleanedTitle || undefined))
    ) {
      return this.handleReadMoreTasks(user, sessionAttributes);
    }

    if (!cleanedTitle) {
      return this.buildElicitSlotResponse(
        'taskTitle',
        'Qual o nome da tarefa?',
        'Diga o nome da tarefa que você deseja adicionar.',
        {
          awaitingTaskTitle: true,
          date: dateSlot,
          time: timeSlot,
          listName: listSlot,
        },
        slots,
      );
    }

    const taskTitle = cleanedTitle.charAt(0).toUpperCase() + cleanedTitle.slice(1);
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

  private handleStop(sessionAttributes?: Record<string, any>) {
    if (sessionAttributes?.awaitingMoreTasks) {
      return this.buildResponse('Tudo bem! Até logo.', true);
    }
    return this.buildResponse('Até logo! Bom proveito com o Tudú.', true);
  }

  private handleFallback(sessionAttributes?: Record<string, any>, slots?: Record<string, any>) {
    if (sessionAttributes?.awaitingTaskTitle) {
      return this.buildElicitSlotResponse(
        'taskTitle',
        'Não consegui entender o nome da tarefa. Diga o que você deseja adicionar, por exemplo: comprar pão.',
        'Por favor, diga o nome da tarefa.',
        sessionAttributes,
        slots,
      );
    }
    if (sessionAttributes?.awaitingMoreTasks) {
      return this.buildResponse(
        'Você gostaria de ouvir o restante das tarefas de hoje ou deseja adicionar um novo tudú?',
        false,
        'Diga "ouvir mais" para ouvir as outras tarefas ou "adicionar tarefa" para criar um tudú.',
        sessionAttributes,
      );
    }
    const speech =
      'Desculpe, não entendi. Você pode perguntar "quais são minhas tarefas de hoje" ou pedir "adicionar uma nova tarefa".';
    return this.buildResponse(speech, false, 'Como posso ajudar no seu Tudú?');
  }

  // ==========================================
  // HELPERS
  // ==========================================

  private isHearMorePhrase(text?: string): boolean {
    if (!text) return false;
    const normalized = text
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');

    const phrases = [
      'ouvir mais',
      'ouvir mais tarefas',
      'quero ouvir mais',
      'quero ouvir mais tarefas',
      'ouvir as outras',
      'ouvir as outras tarefas',
      'ouvir o resto',
      'ouvir o restante',
      'ouvir todas as tarefas',
      'ouvir todas',
      'ler mais',
      'ler mais tarefas',
      'ler todas',
      'ler todas tarefas',
      'ler todas as tarefas',
      'ler todas as tarefas de hoje',
      'ler o resto',
      'ler o restante',
      'falar mais',
      'falar mais tarefas',
      'falar todas',
      'falar todas as tarefas',
      'falar o resto',
      'quais sao as outras',
      'mais tarefas',
      'mais',
      'todas tarefas',
      'todas as tarefas',
      'todas',
      'continuar',
      'continua',
      'sim',
      'quero',
      'pode falar',
      'pode ser',
      'com certeza',
      'claro',
    ];

    return (
      phrases.includes(normalized) ||
      /^(ouvir mais|ler mais|ler todas|falar mais|mais|sim|continuar)/i.test(normalized)
    );
  }

  private isNegativePhrase(text?: string): boolean {
    if (!text) return false;
    const normalized = text
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');

    const phrases = [
      'nao',
      'nao quero',
      'nao precisa',
      'agora nao',
      'deixa',
      'depois',
      'nao obrigado',
      'nao obrigada',
    ];

    return phrases.includes(normalized) || /^nao\b/i.test(normalized);
  }

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
      take: 50,
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

  private cleanTaskTitle(raw?: string): string | null {
    if (!raw || !raw.trim()) return null;
    let title = raw.trim();

    // Regex to remove conversational prefixes when answering "qual o nome da tarefa?"
    const prefixRegex =
      /^(o\s+nome\s+da\s+tarefa\s+[ée]\s+|o\s+nome\s+[ée]\s+|o\s+t[íi]tulo\s+[ée]\s+|a\s+tarefa\s+[ée]\s+|[ée]\s+|chama\s+|adicionar\s+(uma\s+nova\s+tarefa\s+|uma\s+tarefa\s+|nova\s+tarefa\s+|tarefa\s+)?|anotar\s+(uma\s+nova\s+tarefa\s+|uma\s+tarefa\s+|nova\s+tarefa\s+|tarefa\s+)?|criar\s+(uma\s+nova\s+tarefa\s+|uma\s+tarefa\s+|nova\s+tarefa\s+|tarefa\s+)?|colocar\s+(uma\s+tarefa\s+|tarefa\s+)?)/i;

    title = title.replace(prefixRegex, '').trim();

    if (!title) return null;
    return title;
  }

  private buildElicitSlotResponse(
    slotToElicit: string,
    speechText: string,
    repromptText?: string,
    sessionAttributes?: Record<string, any>,
    existingSlots?: Record<string, any>,
  ) {
    const slotsPayload: Record<string, any> = {
      taskTitle: {
        name: 'taskTitle',
        confirmationStatus: 'NONE',
        ...(existingSlots?.taskTitle?.value ? { value: existingSlots.taskTitle.value } : {}),
      },
      date: {
        name: 'date',
        confirmationStatus: 'NONE',
        ...(existingSlots?.date?.value || sessionAttributes?.date
          ? { value: existingSlots?.date?.value || sessionAttributes?.date }
          : {}),
      },
      time: {
        name: 'time',
        confirmationStatus: 'NONE',
        ...(existingSlots?.time?.value || sessionAttributes?.time
          ? { value: existingSlots?.time?.value || sessionAttributes?.time }
          : {}),
      },
      listName: {
        name: 'listName',
        confirmationStatus: 'NONE',
        ...(existingSlots?.listName?.value || sessionAttributes?.listName
          ? { value: existingSlots?.listName?.value || sessionAttributes?.listName }
          : {}),
      },
    };

    return {
      version: '1.0',
      ...(sessionAttributes ? { sessionAttributes } : {}),
      response: {
        outputSpeech: {
          type: 'PlainText',
          text: speechText,
        },
        reprompt: {
          outputSpeech: {
            type: 'PlainText',
            text: repromptText || speechText,
          },
        },
        shouldEndSession: false,
        directives: [
          {
            type: 'Dialog.ElicitSlot',
            slotToElicit,
            updatedIntent: {
              name: ALEXA_INTENTS.CREATE_TASK,
              confirmationStatus: 'NONE',
              slots: slotsPayload,
            },
          },
        ],
      },
    };
  }

  private buildResponse(
    speechText: string,
    shouldEndSession: boolean,
    repromptText?: string,
    sessionAttributes?: Record<string, any>,
  ) {
    return {
      version: '1.0',
      ...(sessionAttributes ? { sessionAttributes } : {}),
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

  // ==========================================
  // ALEXA HOUSEHOLD LIST EVENTS (NATIVE LISTS)
  // ==========================================

  private async handleListItemsCreated(user: any, body: any) {
    const listId = body?.request?.body?.listId;
    const listItemIds: string[] = body?.request?.body?.listItemIds || [];
    const apiEndpoint = body?.context?.System?.apiEndpoint || 'https://api.amazonalexa.com';
    const apiAccessToken = body?.context?.System?.apiAccessToken;

    if (!apiAccessToken || !listId || listItemIds.length === 0) {
      return { version: '1.0', response: {} };
    }

    for (const itemId of listItemIds) {
      try {
        const res = await fetch(`${apiEndpoint}/v2/householdlists/${listId}/items/${itemId}`, {
          headers: {
            Authorization: `Bearer ${apiAccessToken}`,
            'Content-Type': 'application/json',
          },
        });

        if (res.ok) {
          const itemData = await res.json();
          if (itemData?.value && itemData.value.trim()) {
            const taskTitle =
              itemData.value.trim().charAt(0).toUpperCase() + itemData.value.trim().slice(1);
            await this.prisma.task.create({
              data: {
                id: randomUUID(),
                userId: user.id,
                title: taskTitle,
                dueDate: new Date(),
                hasTime: false,
                done: itemData.status === 'completed',
                isUnlisted: true,
                order: 0,
                description: `alexa_item_id:${itemData.id}`,
              },
            });
            this.logger.log(`Created Tudú task from Alexa list event: "${taskTitle}" for user ${user.email}`);
          }
        }
      } catch (err: any) {
        this.logger.error(`Error syncing created list item ${itemId} from Alexa:`, err?.message);
      }
    }

    return { version: '1.0', response: {} };
  }

  private async handleListItemsUpdated(user: any, body: any) {
    const listId = body?.request?.body?.listId;
    const listItemIds: string[] = body?.request?.body?.listItemIds || [];
    const apiEndpoint = body?.context?.System?.apiEndpoint || 'https://api.amazonalexa.com';
    const apiAccessToken = body?.context?.System?.apiAccessToken;

    if (!apiAccessToken || !listId || listItemIds.length === 0) {
      return { version: '1.0', response: {} };
    }

    for (const itemId of listItemIds) {
      try {
        const res = await fetch(`${apiEndpoint}/v2/householdlists/${listId}/items/${itemId}`, {
          headers: {
            Authorization: `Bearer ${apiAccessToken}`,
            'Content-Type': 'application/json',
          },
        });

        if (res.ok) {
          const itemData = await res.json();
          // Find matching task by alexa_item_id or title
          const task = await this.prisma.task.findFirst({
            where: {
              userId: user.id,
              OR: [
                { description: { contains: `alexa_item_id:${itemData.id}` } },
                { title: { equals: itemData.value, mode: 'insensitive' } },
              ],
            },
          });

          if (task) {
            await this.prisma.task.update({
              where: { id: task.id },
              data: {
                done: itemData.status === 'completed',
                title: itemData.value || task.title,
              },
            });
            this.logger.log(`Updated Tudú task status to ${itemData.status} from Alexa list event`);
          }
        }
      } catch (err: any) {
        this.logger.error(`Error syncing updated list item ${itemId} from Alexa:`, err?.message);
      }
    }

    return { version: '1.0', response: {} };
  }

  private async handleListItemsDeleted(user: any, body: any) {
    const listItemIds: string[] = body?.request?.body?.listItemIds || [];

    for (const itemId of listItemIds) {
      try {
        const task = await this.prisma.task.findFirst({
          where: {
            userId: user.id,
            description: { contains: `alexa_item_id:${itemId}` },
          },
        });

        if (task) {
          await this.prisma.task.update({
            where: { id: task.id },
            data: { deletedAt: new Date() },
          });
          this.logger.log(`Soft-deleted Tudú task from Alexa list deleted event`);
        }
      } catch (err: any) {
        this.logger.error(`Error deleting task for Alexa item ${itemId}:`, err?.message);
      }
    }

    return { version: '1.0', response: {} };
  }

  private async handleSystemOrListEvent(requestType: string, body: any): Promise<any> {
    try {
      const user = await this.resolveUserFromPayload(body);
      if (user) {
        if (requestType === ALEXA_LIST_EVENTS.ITEMS_CREATED) {
          await this.handleListItemsCreated(user, body);
        } else if (requestType === ALEXA_LIST_EVENTS.ITEMS_UPDATED) {
          await this.handleListItemsUpdated(user, body);
        } else if (requestType === ALEXA_LIST_EVENTS.ITEMS_DELETED) {
          await this.handleListItemsDeleted(user, body);
        }
      } else {
        this.logger.warn(`No user resolved for Alexa event ${requestType}`);
      }
    } catch (err: any) {
      this.logger.error(`Error processing Alexa event ${requestType}:`, err?.message);
    }

    // Always return empty 200 response for events
    return { version: '1.0', response: {} };
  }

  private async resolveUserFromPayload(body: any): Promise<any> {
    const accessToken =
      body?.context?.System?.user?.accessToken || body?.session?.user?.accessToken;

    if (accessToken) {
      try {
        const payload = this.jwtService.verify(accessToken);
        if (payload?.sub) {
          const user = await this.prisma.user.findUnique({
            where: { id: payload.sub },
          });
          if (user) return user;
        }
      } catch {
        this.logger.warn('Invalid Alexa access token provided in payload');
      }
    }

    // Fallback: Check if Amazon Alexa userId is mapped in UserSettings
    const amazonUserId = body?.context?.System?.user?.userId;
    if (amazonUserId) {
      const settings = await this.prisma.userSettings.findFirst({
        where: {
          generalSettings: {
            path: ['alexaUserId'],
            equals: amazonUserId,
          },
        },
        include: { user: true },
      });
      if (settings?.user) {
        return settings.user;
      }
    }

    return null;
  }

  private async associateAlexaUserId(userId: string, alexaUserId: string): Promise<void> {
    const settings = await this.prisma.userSettings.findUnique({ where: { userId } });
    const generalSettings = (settings?.generalSettings as Record<string, any>) || {};
    if (generalSettings.alexaUserId !== alexaUserId) {
      generalSettings.alexaUserId = alexaUserId;
      await this.prisma.userSettings.upsert({
        where: { userId },
        update: { generalSettings },
        create: { userId, generalSettings },
      });
    }
  }
}
