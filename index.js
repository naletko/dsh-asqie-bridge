// Host plugin: bridge one running DeepSeek Harness instance to Time Asqie.
//
// It registers as a Time Asqie coding agent, polls for runs, executes them
// against the local DSH session controller, streams durable events, and relays
// questions/permission requests so they can be answered from the phone.
//
// Credentials/config: $DSH_HOME/asqie-bridge.json or ASQIE_* environment vars.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export const inject = ['sessionController', 'sessionQuery', 'agents'];
export const name = 'asqie-bridge';

const DEFAULT_API_URL = 'https://api.asqie.pro/api/v1';
const PLUGIN_VERSION = '0.1.0';

function logger(message, ...args) {
  console.log(`[asqie-bridge] ${message}`, ...args);
}

function warn(message, ...args) {
  console.warn(`[asqie-bridge] ${message}`, ...args);
}

function asqieHome() {
  return process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
}

function loadSettings(config = {}) {
  let file = {};
  const configFile = path.join(asqieHome(), 'asqie-bridge.json');
  try {
    if (fs.existsSync(configFile)) {
      file = JSON.parse(fs.readFileSync(configFile, 'utf8'));
    }
  } catch (error) {
    warn(`could not read ${configFile}: ${String(error)}`);
  }

  const pick = (key, fallback) => {
    if (config[key] !== undefined && config[key] !== '') return config[key];
    if (file[key] !== undefined && file[key] !== '') return file[key];
    const envKey = `ASQIE_${key.replace(/[A-Z]/g, (m) => `_${m}`).toUpperCase()}`;
    if (process.env[envKey] !== undefined && process.env[envKey] !== '') return process.env[envKey];
    return fallback;
  };

  const apiUrl = String(pick('apiUrl', DEFAULT_API_URL)).replace(/\/+$/, '');
  const agentToken = String(pick('agentToken', ''));
  const machineName = String(pick('machineName', `dsh-${os.hostname().toLowerCase()}`));
  const agentName = String(pick('agentName', 'DeepSeek Harness'));
  const autoApprove = Boolean(pick('autoApprove', true));
  const heartbeatMs = Number(pick('heartbeatMs', 20000));
  const claimMs = Number(pick('claimMs', 2000));
  const maxConcurrent = Number(pick('maxConcurrent', 1));

  return {
    apiUrl,
    agentToken,
    machineName,
    agentName,
    autoApprove,
    heartbeatMs,
    claimMs,
    maxConcurrent,
  };
}

function createHttp(settings) {
  async function request(method, endpoint, body) {
    const response = await fetch(`${settings.apiUrl}${endpoint}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-Agent-Token': settings.agentToken,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    let payload = null;
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = { raw: text };
      }
    }
    if (!response.ok) {
      throw new Error(`Time Asqie ${method} ${endpoint} failed: ${response.status} ${text.slice(0, 400)}`);
    }
    return payload;
  }

  return {
    register(data) {
      return request('POST', '/coding-agents/register', data);
    },
    heartbeat(agentId, sessions, models) {
      return request('POST', '/coding-agents/heartbeat', {
        agent_id: agentId,
        machine_name: settings.machineName,
        version: PLUGIN_VERSION,
        available_adapters: ['dsh'],
        models: models || [],
        sessions: sessions ?? null,
      });
    },
    claim(agentId) {
      return request('POST', '/coding-agents/runs/claim', {
        agent_id: agentId,
        available_adapters: ['dsh'],
      });
    },
    started(runId, sessionId) {
      return request('POST', `/coding-agents/runs/${runId}/started`, {
        remote_session_id: sessionId,
      });
    },
    postEvents(runId, events) {
      return request('POST', `/coding-agents/runs/${runId}/events`, { events });
    },
    complete(runId, data) {
      return request('POST', `/coding-agents/runs/${runId}/complete`, data);
    },
    fail(runId, data) {
      return request('POST', `/coding-agents/runs/${runId}/fail`, data);
    },
    ack(runId, commandId, result) {
      return request('POST', `/coding-agents/runs/${runId}/commands/${commandId}/ack`, { result });
    },
    createInteraction(runId, data) {
      return request('POST', `/coding-agents/runs/${runId}/interactions`, data);
    },
    postSessionMessages(sessions) {
      return request('POST', '/coding-agents/sessions/messages', { sessions });
    },
  };
}

function eventText(blocks) {
  if (!Array.isArray(blocks)) return '';
  return blocks
    .filter((block) => block && block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('');
}

function eventTextWithReasoning(blocks) {
  if (!Array.isArray(blocks)) return [];
  return blocks
    .filter((block) => block && (block.type === 'text' || block.type === 'reasoning') && typeof block.text === 'string')
    .map((block) => ({ kind: block.type, text: block.text }));
}

class RunBuffer {
  constructor(client, runId, onFinish) {
    this.client = client;
    this.runId = runId;
    this.onFinish = onFinish;
    this.sequence = 0;
    this.queue = [];
    this.timer = setInterval(() => void this.flush(), 300);
    this.closed = false;
  }

  push(type, payload) {
    if (this.closed) return;
    this.sequence += 1;
    this.queue.push({
      sequence: this.sequence,
      timestamp: new Date().toISOString(),
      type,
      payload,
    });
    if (this.queue.length >= 20) void this.flush();
  }

  async flush() {
    if (this.closed || this.queue.length === 0) return;
    const batch = this.queue.splice(0);
    try {
      await this.client.postEvents(this.runId, batch);
    } catch (error) {
      warn(`event upload failed for run #${this.runId}: ${String(error)}`);
      this.queue.unshift(...batch);
    }
  }

  async close() {
    if (this.closed) return;
    clearInterval(this.timer);
    await this.flush();
    this.closed = true;
    this.onFinish?.();
  }
}

function publicQuestion(question, index) {
  return {
    id: String(question.id ?? `q${index + 1}`),
    question: String(question.question ?? ''),
    header: question.header ? String(question.header) : undefined,
    options: Array.isArray(question.options)
      ? question.options.map((option) => ({
          label: String(option.label ?? ''),
          description: option.description ? String(option.description) : undefined,
        }))
      : [],
    multiple: Boolean(question.multiSelect),
    custom: true,
  };
}

export function apply(ctx, config = {}) {
  const settings = loadSettings(config);
  if (!settings.agentToken) {
    throw new Error(
      `asqie-bridge: no Time Asqie agent token. Put {"apiUrl": "...", "agentToken": "asq_...", "machineName": "..."} into ${path.join(asqieHome(), 'asqie-bridge.json')}.`,
    );
  }

  const client = createHttp(settings);
  const state = {
    agentId: null,
    autoApprove: settings.autoApprove,
    controlledSessions: new Map(), // sessionId -> run context
    activeRuns: new Map(), // runId -> run context
    pendingInteractions: new Map(), // externalId -> {resolve, reject, ctx}
    timers: [],
    stopped: false,
  };

  // ---------------------------------------------------------------------
  // Session helpers
  // ---------------------------------------------------------------------

  async function listSessions() {
    try {
      const records = await ctx.sessionQuery.listSessions();
      const recent = records
        .filter((record) => record?.header?.id)
        .sort((left, right) => (right.header.createdAt || 0) - (left.header.createdAt || 0))
        .slice(0, 50);
      const ids = recent.map((record) => record.header.id);
      let titles = new Map();
      try {
        const snapshots = await ctx.sessionQuery.readTitleSnapshots(ids);
        for (const result of snapshots) {
          if (result?.status === 'fulfilled' && result.value?.title) {
            titles.set(result.value.session?.id ?? result.value.title?.sessionId, result.value.title);
          }
        }
      } catch (error) {
        warn(`title snapshots failed: ${String(error)}`);
      }

      return recent.map((record) => {
        const header = record.header;
        const title = titles.get(header.id);
        const titleText = typeof title?.title === 'string' ? title.title : undefined;
        return {
          id: header.id,
          title: titleText || 'Untitled',
          directory: header.cwd || '',
          created: Number(header.createdAt || 0),
          updated: Number(title?.updatedAt || header.createdAt || 0),
        };
      });
    } catch (error) {
      warn(`listSessions failed: ${String(error)}`);
      return null;
    }
  }

  async function readSurfaceMessages(sessionId) {
    try {
      const surface = await ctx.sessionQuery.readSurface(sessionId);
      const messages = [];
      for (const event of surface?.events || []) {
        const data = event?.data || {};
        if (event.type === 'user/message') {
          const text = eventText(data.content);
          // Runtime-context snapshots are injected as user messages; they are
          // not part of the human conversation shown on the phone.
          const isRuntimeContext = /^(Current runtime context\.|MNEMON RUNTIME MEMORY SNAPSHOT|Time sampled while preparing|Browser time zone)/.test(text);
          if (text.trim() && !isRuntimeContext) {
            messages.push({ role: 'user', text, timestamp: Number(event.time || 0) });
          }
        } else if (event.type === 'assistant/message') {
          const text = eventText(data.message?.content);
          if (text.trim()) messages.push({ role: 'assistant', text, timestamp: Number(event.time || 0) });
        }
      }
      return messages.slice(-200);
    } catch (error) {
      warn(`readSurface(${sessionId}) failed: ${String(error)}`);
      return [];
    }
  }

  async function syncSessionMessages(sessionId) {
    const messages = await readSurfaceMessages(sessionId);
    if (messages.length === 0) return;
    try {
      await client.postSessionMessages([{ session_id: sessionId, messages }]);
    } catch (error) {
      warn(`session message sync failed for ${sessionId}: ${String(error)}`);
    }
  }

  // ---------------------------------------------------------------------
  // Event streaming
  // ---------------------------------------------------------------------

  ctx.on('session/event', (session, event) => {
    const runCtx = state.controlledSessions.get(session.id);
    if (!runCtx) return;

    const data = event.data || {};
    switch (event.type) {
      case 'assistant/message': {
        for (const block of eventTextWithReasoning(data.message?.content)) {
          if (block.kind === 'reasoning') {
            runCtx.buffer.push('output', { kind: 'reasoning', text: block.text });
          } else {
            runCtx.lastAssistantText = block.text;
            runCtx.buffer.push('message', { role: 'assistant', text: block.text });
          }
        }
        return;
      }
      case 'tool/call':
        runCtx.buffer.push('tool', {
          name: String(data.name || data.tool || 'tool'),
          input: typeof data.arguments === 'string' ? safeJson(data.arguments) : data.arguments || {},
          callID: data.callId,
        });
        return;
      case 'tool/result': {
        const text = eventText(data.message?.content);
        runCtx.buffer.push('command', {
          callID: data.toolCallId || data.message?.toolCallId,
          output: text,
        });
        return;
      }
      case 'user/message': {
        const text = eventText(data.content);
        if (text.includes(runCtx.run.prompt)) {
          runCtx.promptStarted = true;
        }
        return;
      }
      case 'turn/end':
        runCtx.lastTurnEnd = data.reason;
        if (runCtx.promptStarted) runCtx.resolveIdle?.();
        return;
      case 'session/error':
        runCtx.fail(data.error);
        return;
      default:
        return;
    }
  });

  ctx.on('api-session/status', (sessionId, running) => {
    const runCtx = state.controlledSessions.get(sessionId);
    if (!runCtx) return;
    if (running) runCtx.sawRunning = true;
    else if (runCtx.prompted && runCtx.promptStarted) runCtx.resolveIdle?.();
  });

  function safeJson(text) {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  // ---------------------------------------------------------------------
  // Interactive questions and approvals
  // ---------------------------------------------------------------------

  function waitForInteraction(externalId) {
    return new Promise((resolve, reject) => {
      state.pendingInteractions.set(externalId, { resolve, reject });
    });
  }

  async function publishQuestion(runCtx, request) {
    const externalId = `dsh-question-${randomUUID()}`;
    const questions = (request.questions || []).map(publicQuestion);
    await client.createInteraction(runCtx.run.id, {
      kind: 'question',
      external_id: externalId,
      title: questions[0]?.header || 'Question',
      payload: { questions },
    });
    runCtx.buffer.push('progress', { stage: 'waiting_for_user', kind: 'question' });
    const answer = await waitForInteraction(externalId);
    const answers = Array.isArray(answer?.answers) ? answer.answers : [];
    return {
      answers: questions.map((question, index) => {
        const item = answers[index] || {};
        const selected = Array.isArray(item.selected) ? item.selected : [];
        const custom = typeof item.custom === 'string' ? item.custom : undefined;
        return {
          id: question.id,
          selected,
          ...(custom !== undefined ? { custom } : {}),
        };
      }),
    };
  }

  async function publishPermission(runCtx, request) {
    if (state.autoApprove) {
      runCtx.buffer.push('status', { status: 'permission_auto_approved', permission: request.toolName });
      return 'allowed-once';
    }
    const externalId = `dsh-permission-${randomUUID()}`;
    await client.createInteraction(runCtx.run.id, {
      kind: 'permission',
      external_id: externalId,
      title: String(request.toolName || 'Permission request'),
      payload: {
        permission: request.toolName || 'tool',
        patterns: request.reason ? [String(request.reason)] : [],
        metadata: {
          callId: request.callId,
          reason: request.reason,
        },
      },
    });
    runCtx.buffer.push('progress', { stage: 'waiting_for_user', kind: 'permission' });
    const answer = await waitForInteraction(externalId);
    const reply = String(answer?.reply || answer?.answer?.reply || '');
    return reply === 'reject' ? 'rejected' : 'allowed-once';
  }

  ctx.on('approval/request', async (request, next) => {
    const sessionId = request.agent?.session?.id;
    const runCtx = sessionId ? state.controlledSessions.get(sessionId) : undefined;
    if (!runCtx) return next();
    logger(`approval request for controlled session ${sessionId}: ${request.toolName}`);
    try {
      return await publishPermission(runCtx, request);
    } catch (error) {
      warn(`approval bridge failed: ${String(error)}`);
      return 'rejected';
    }
  }, { global: true, prepend: true });

  ctx.on('user-questions/request', async (request, next) => {
    const sessionId = request.agent?.session?.id;
    const runCtx = sessionId ? state.controlledSessions.get(sessionId) : undefined;
    if (!runCtx) return next();
    logger(`question request for controlled session ${sessionId} (${request.questions?.length ?? 0} questions)`);
    try {
      return await publishQuestion(runCtx, request);
    } catch (error) {
      warn(`question bridge failed: ${String(error)}`);
      return { answers: [] };
    }
  }, { global: true, prepend: true });

  // ---------------------------------------------------------------------
  // Run execution
  // ---------------------------------------------------------------------

  async function executeRun(run) {
    const directory = run.working_directory || process.cwd();
    let sessionId = run.remote_session_id || '';

    const runCtx = {
      run,
      sessionId,
      buffer: new RunBuffer(client, run.id, () => {
        state.controlledSessions.delete(sessionId);
        state.activeRuns.delete(run.id);
      }),
      prompted: false,
      promptStarted: false,
      sawRunning: false,
      lastAssistantText: '',
      lastTurnEnd: null,
      resolveIdle: null,
      fail: null,
    };

    const idlePromise = new Promise((resolve, reject) => {
      runCtx.resolveIdle = resolve;
      runCtx.fail = reject;
    });

    try {
      if (!sessionId) {
        logger(`creating DSH session in ${directory}`);
        const created = await ctx.sessionController.create({
          cwd: directory,
          agentPreset: 'standard',
        });
        sessionId = created.sessionId;
        runCtx.sessionId = sessionId;
        logger(`created DSH session ${sessionId}`);
      }

      state.controlledSessions.set(sessionId, runCtx);
      state.activeRuns.set(run.id, runCtx);
      await client.started(run.id, sessionId);
      runCtx.buffer.push('status', { status: 'running', sessionID: sessionId });

      runCtx.prompted = true;
      logger(`prompting DSH session ${sessionId}`);
      const promptAbort = new AbortController();
      runCtx.promptAbort = promptAbort;
      await ctx.sessionController.prompt(
        {
          requestId: `asqie-${run.id}-${randomUUID()}`,
          sessionId,
          mode: 'queue',
          content: [{ type: 'text', text: run.prompt }],
        },
        promptAbort.signal,
      );

      // If the agent finished before the first status event, do not wait
      // forever: the turn/end listener resolves it.
      const timeout = setTimeout(() => runCtx.resolveIdle?.(), 2 * 60 * 60 * 1000);
      try {
        await idlePromise;
      } finally {
        clearTimeout(timeout);
      }

      const resultText = runCtx.lastAssistantText || 'Completed';
      await runCtx.buffer.close();
      await client.complete(run.id, {
        exit_code: 0,
        result: resultText,
        remote_session_id: sessionId,
      });
      await syncSessionMessages(sessionId);
      logger(`run #${run.id} completed`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      warn(`run #${run.id} failed: ${message}`);
      if (error instanceof Error && error.stack) warn(error.stack);
      await runCtx.buffer.close();
      try {
        await client.fail(run.id, { exit_code: 1, error_code: 'dsh_run_failed', message });
      } catch (failError) {
        warn(`fail report failed: ${String(failError)}`);
      }
      if (sessionId) state.controlledSessions.delete(sessionId);
      state.activeRuns.delete(run.id);
    }
  }

  function cancelRun(runCtx) {
    const sessionId = runCtx.sessionId;
    try {
      ctx.sessionController.cancel({ sessionId });
    } catch (error) {
      warn(`cancel failed for ${sessionId}: ${String(error)}`);
    }
    runCtx.resolveIdle?.();
  }

  // ---------------------------------------------------------------------
  // Heartbeat / claim loops
  // ---------------------------------------------------------------------

  async function handleCommand(command) {
    const payload = command.payload || {};
    if (command.command === 'cancel') {
      const runCtx = state.activeRuns.get(command.run_id);
      if (runCtx) cancelRun(runCtx);
    } else if (command.command === 'answer_interaction') {
      const externalId = String(payload.external_id || '');
      const pending = state.pendingInteractions.get(externalId);
      if (pending) {
        state.pendingInteractions.delete(externalId);
        if (payload.reject === true) pending.reject(new Error('Rejected by user'));
        else pending.resolve(payload.answer);
      }
    }
    try {
      await client.ack(command.run_id, command.command_id, 'done');
    } catch (error) {
      warn(`ack failed: ${String(error)}`);
    }
  }

  async function heartbeat() {
    if (state.stopped || !state.agentId) return;
    try {
      const sessions = await listSessions();
      const response = await client.heartbeat(state.agentId, sessions, []);
      if (response?.settings && typeof response.settings.auto_approve_permissions === 'boolean') {
        state.autoApprove = response.settings.auto_approve_permissions;
      }
      for (const command of response?.commands || []) {
        await handleCommand(command);
      }
    } catch (error) {
      warn(`heartbeat failed: ${String(error)}`);
    }
  }

  async function claimAndRun() {
    if (state.stopped || !state.agentId) return;
    if (state.activeRuns.size >= settings.maxConcurrent) return;
    try {
      const response = await client.claim(state.agentId);
      if (!response?.run) return;
      logger(`claimed run #${response.run.id}`);
      void executeRun(response.run);
    } catch (error) {
      warn(`claim failed: ${String(error)}`);
    }
  }

  async function start() {
    try {
      const response = await client.register({
        name: settings.agentName,
        machine_name: settings.machineName,
        version: PLUGIN_VERSION,
        available_adapters: ['dsh'],
        capabilities: ['execute', 'stream_output', 'cancel', 'list_sessions', 'questions', 'permissions'],
        models: [],
        sessions: await listSessions(),
      });
      state.agentId = response.id;
      logger(`registered as agent #${response.id} (${settings.machineName})`);
    } catch (error) {
      warn(`registration failed: ${String(error)}`);
      return;
    }

    state.timers.push(setInterval(() => void heartbeat(), settings.heartbeatMs));
    state.timers.push(setInterval(() => void claimAndRun(), settings.claimMs));
    await heartbeat();
    logger('bridge running');
  }

  void start();

  ctx.effect(() => () => {
    state.stopped = true;
    for (const timer of state.timers) clearInterval(timer);
    for (const pending of state.pendingInteractions.values()) {
      pending.reject(new Error('asqie bridge stopped'));
    }
    state.pendingInteractions.clear();
  });
}
