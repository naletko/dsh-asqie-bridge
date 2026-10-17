# dsh-asqie-bridge

Удалённое управление DeepSeek Harness с телефона через Time Asqie: те же сессии,
что открыты в DSH на Mac/Windows, можно читать и продолжать из панели
**Coding Agents**, а вопросы и разрешения — отвечать с телефона.

Плагин ставится в профиль DSH (`desktop` или отдельный), работает host-частью
внутри приложения и общается с Time Asqie по существующему протоколу
агент-демона (register / heartbeat / claim / events / complete).

## Что умеет

- список сессий DSH (включая созданные в GUI) в Time Asqie;
- история сообщений сессий;
- новый чат с телефона: создаёт сессию DSH в выбранной директории;
- продолжение существующей сессии (`промпт` уходит в неё);
- живой стрим ответов/инструментов;
- вопросы `ask_user_question` — карточка с вариантами в телефоне, ответ
  возвращается агенту;
- разрешения (`approval/request`) — авто-апрув по настройке агента или
  карточка Allow once / Always allow / Deny;
- отмену запуска.

## Требования

- DSH 0.2.1-rc.2 (внутренние API могут меняться между версиями);
- Time Asqie: создан агент (Coding Agents → Add agent) с адаптером `dsh`;
- доступ к API Time Asqie с этой машины.

## Установка

1. Создайте агента в Time Asqie: `/timekeeping/settings` → Coding Agents →
   Add agent. Сохраните токен (`asq_…`).
2. Положите конфиг в `$DSH_HOME/asqie-bridge.json` (обычно `~/.dsh/`):

   ```json
   {
     "apiUrl": "https://api.asqie.pro/api/v1",
     "agentToken": "asq_...",
     "machineName": "alex-macbook",
     "agentName": "Alex MacBook",
     "autoApprove": true
   }
   ```

   Токен и URL можно также задать переменными окружения
   `ASQIE_API_URL`, `ASQIE_AGENT_TOKEN`, `ASQIE_AGENT_MACHINE`,
   `ASQIE_AGENT_NAME`.
3. Установите плагин в профиль:

   ```bash
   dsh plugin --profile desktop add github:naletko/dsh-asqie-bridge
   # или локально:
   dsh plugin --profile desktop add link:/path/to/dsh-asqie-bridge
   ```

4. Перезапустите DSH. В логе DSH должно появиться:

   ```
   [asqie-bridge] registered as agent #12 (alex-macbook)
   [asqie-bridge] bridge running
   ```

5. В Time Asqie агент станет online; его сессии появятся в Coding Agents.

## Настройки

| Поле | По умолчанию | Значение |
|---|---|---|
| `apiUrl` | `https://api.asqie.pro/api/v1` | база API Time Asqie |
| `agentToken` | — | токен агента (обязателен) |
| `machineName` | `dsh-<hostname>` | стабильный id машины |
| `agentName` | `DeepSeek Harness` | имя в UI |
| `autoApprove` | `true` | авто-апрув разрешений; значение из Time Asqie на heartbeat переопределяет |
| `heartbeatMs` | `20000` | период heartbeat |
| `claimMs` | `2000` | период опроса запусков |
| `maxConcurrent` | `1` | одновременных запусков |

## Ограничения

- Плагин живёт внутри запущенного DSH: если приложение закрыто, агент offline,
  сессии недоступны (история остаётся в Time Asqie).
- DSH не даёт двум процессам владеть одной сессией; не запускайте второй
  DSH-профиль на тех же сессиях.
- Внутренние API DSH (0.2.1-rc) могут меняться; при обновлении DSH проверяйте
  плагин.
- `autoApprove` — осознанно опасная настройка: разрешения выполняются без
  подтверждения. Вопросы с вариантами всё равно показываются.
