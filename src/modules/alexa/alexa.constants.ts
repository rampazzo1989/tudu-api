export const ALEXA_INTENTS = {
  LAUNCH_REQUEST: 'LaunchRequest',
  GET_TODAY_TASKS: 'GetTodayTasksIntent',
  CREATE_TASK: 'CreateTaskIntent',
  GET_NOTIFICATIONS: 'GetNotificationsIntent',
  HELP: 'AMAZON.HelpIntent',
  CANCEL: 'AMAZON.CancelIntent',
  STOP: 'AMAZON.StopIntent',
  FALLBACK: 'AMAZON.FallbackIntent',
} as const;

export const ALEXA_LIST_EVENTS = {
  ITEMS_CREATED: 'AlexaHouseholdListEvent.ItemsCreated',
  ITEMS_UPDATED: 'AlexaHouseholdListEvent.ItemsUpdated',
  ITEMS_DELETED: 'AlexaHouseholdListEvent.ItemsDeleted',
} as const;

export const ALEXA_PAIRING_TTL_MS = 10 * 60 * 1000; // 10 minutes
export const ALEXA_AUTH_CODE_TTL_SECONDS = 300; // 5 minutes
export const ALEXA_ACCESS_TOKEN_TTL_SECONDS = 90 * 24 * 60 * 60; // 90 days
